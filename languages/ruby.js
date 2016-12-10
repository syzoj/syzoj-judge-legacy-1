let Promise = require('bluebird');
let path = require('path');
let child_process = Promise.promisifyAll(require('child_process'));
let fs = Promise.promisifyAll(require('fs'));

const BUNDLE_SOURCE = '#include <stdlib.h>\n#include <string.h>\n#include <unistd.h>\n\nint main(int argc, char **argv)\n{\n\tsize_t len = strlen(argv[0]);\n\tchar *buf = (char *)malloc(len + 3); // ".rb"\n\tmemcpy(buf, argv[0], len);\n\tmemcpy(buf + len, ".rb", 4);\n\n\tconst char *RUBY_PATH = "/usr/bin/ruby";\n\texecl(RUBY_PATH, RUBY_PATH, buf, NULL);\n}\n';

async function isFile(file) {
  try {
    let stat = await fs.statAsync(file);
    return stat.isFile();
  } catch (e) {
    return false;
  }
}

module.exports = {
  minOutputLimit: 10240,
  minProcessLimit: 2,
  minMemory: 768 * 1024,
  getFilename(file) {
    return file + '.rb';
  },
  async compile(file) {
    let parsed = path.parse(file)
    let execFile = path.join(parsed.dir, parsed.name);

    if (await isFile(execFile)) {
      await fs.unlinkAsync(execFile);
    }

    let output, success = false;

    try {
      output = await child_process.execAsync(`(ruby -c ${file} 2>&1 && echo -n Y) || echo -n N`, {
        timeout: 5000
      });

      let ch = output[output.length - 1];
      output = output.substr(0, output.length - 1);

      if (ch === 'Y') {
        success = true;
        await fs.writeFileAsync(execFile + '.c', BUNDLE_SOURCE);
        await child_process.execAsync(`gcc ${execFile}.c -o ${execFile} -static`);
      }
    } catch (e) {
      output = 'Time limit exceeded while compiling';
    }

    return {
      success: success,
      execFile: execFile,
      output: output,
      extraFiles: !success ? null : [{
        name: path.basename(file),
        mode: parseInt('444', 8),
        data: await fs.readFileAsync(file)
      }]
    };
  }
};
