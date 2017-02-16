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
  minProcessLimit: 1,
  minMemory: 0,
  largeStack: true,
  getFilename(file) {
    return file + '.c';
  },
  async compile(file) {
    let parsed = path.parse(file)
    let execFile = path.join(parsed.dir, parsed.name);

    if (await isFile(execFile)) {
      await fs.unlinkAsync(execFile);
    }

    let output;
    try {
      output = await child_process.execAsync(`gcc ${file} -o ${execFile} -O2 -lm -static -DONLINE_JUDGE -fdiagnostics-color=always 2>&1 || true`, {
        timeout: 5000
      });
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
