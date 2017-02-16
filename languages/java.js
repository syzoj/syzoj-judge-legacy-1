let Promise = require('bluebird');
let path = require('path');
let child_process = Promise.promisifyAll(require('child_process'));
let fs = Promise.promisifyAll(require('fs'));

async function isFile(file) {
  try {
    let stat = await fs.statAsync(file);
    return stat.isFile();
  } catch (e) {
    return false;
  }
}

module.exports = {
  minOutputLimit: 1024,
  minProcessLimit: 2,
  minMemory: 0,
  largeStack: false,
  getFilename(file) {
    return file + '.java';
  },
  async compile(file) {
    let parsed = path.parse(file)
    let execFile = path.join(parsed.dir, parsed.name);

    if (await isFile(execFile)) {
      await fs.unlinkAsync(execFile);
    }

    let output;

    try {
      output = await child_process.execAsync(`gcj ${file} 2>&1 || true`, {
        timeout: 5000
      });

      let className = null, re = /^\S[\S\s]*error: The public type ([a-zA-Z_$0-9]+) must be defined in its own file$/;
      for (let line of output.split('\n')) {
        let res = re.exec(line);
        if (res) {
          className = res[1];
          break;
        }
      }

      if (!className) {
        output = 'Failed to detect the main class name, here is the compiler output:\n\n' + output;
      } else {
        let dir = `${execFile}_dir`;
        await fs.mkdirAsync(dir);
        let newFile = `${dir}/${className}.java`
        await fs.renameAsync(file, newFile);

        let newFileEscaped = newFile.split('$').join('\\$');
        let classNameEscaped = className.split('$').join('\\$');
        output = await child_process.execAsync(`gcj ${newFileEscaped} -o ${execFile} --main=${classNameEscaped} -O2 2>&1 || true`, {
          timeout: 5000
        });
      }
    } catch (e) {
      output = 'Time limit exceeded while compiling';
    }

    return {
      success: await isFile(execFile),
      execFile: execFile,
      output: output
    };
  }
};
