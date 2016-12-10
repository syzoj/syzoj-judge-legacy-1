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
  minOutputLimit: 10240,
  minProcessLimit: 2,
  getFilename(file) {
    return file + '.cs';
  },
  async compile(file) {
    let parsed = path.parse(file)
    let execFile = path.join(parsed.dir, parsed.name);

    if (await isFile(execFile)) {
      await fs.unlinkAsync(execFile);
    }

    let output;

    try {
      output = await child_process.execAsync(`mcs ${file} -define:ONLINE_JUDGE 2>&1 || true`, {
        timeout: 5000
      });
      output += await child_process.execAsync(`mkbundle ${execFile}.exe -o ${execFile} 2>&1 || true`, {
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
