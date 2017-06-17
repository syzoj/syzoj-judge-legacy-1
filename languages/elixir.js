let Promise = require('bluebird');
let path = require('path');
let child_process = Promise.promisifyAll(require('child_process'));
let fs = Promise.promisifyAll(require('fs'));

const BUNDLE_SOURCE = '#include <bits/stdc++.h>\nusing namespace std;\nint main(){\nsystem("elixir -e Main.main()");\n}'

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
  minMemory: 0,
  largeStack: false,
  getFilename(file) {
    return file + '.ex';
  },
  async compile(file) {
    let parsed = path.parse(file)
    let execFile = path.join(parsed.dir, parsed.name);

    if (await isFile(execFile)) {
      await fs.unlinkAsync(execFile);
    }

    let output, success = false;

    try {
      output = await child_process.execAsync(`(elixirc ${file} 2>&1 && echo -n Y) || echo -n N`, {
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
        targetFilename: path.basename(file),
        filename: file
      }]
    };
  }
};
