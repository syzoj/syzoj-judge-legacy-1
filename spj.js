let Promise = require('bluebird');
let fs = Promise.promisifyAll(require('fs'));
let path = require('path');
let SandCastle = require('sandcastle').SandCastle;

async function runSpecialJudge(task, dir, input, user_out, answer) {
  try {
    let code;
    try {
      code = (await fs.readFileAsync(path.join(dir, 'spj.js'))).toString();
    } catch (e) {
      return null;
    }

    let sandbox = new SandCastle({
      timeout: config.spj_time_limit,
      memoryLimitMB: config.spj_memory_limit,
      useStrictMode: true
    });
    let script = sandbox.createScript(code);

    let result = await new Promise(async (resolve, reject) => {
      script.on('exit', (err, output) => {
        sandbox.kill();
        if (err) {
          reject({
            type: 'Special Judge exited with error',
            err: err.stack ? err.stack : err.toString()
          });
        } else resolve(output);
      });

      script.on('timeout', (err, output) => {
        sandbox.kill();
        reject({
          type: 'Special Judge time limit exceeded',
          err: err.stack ? err.stack : err.toString()
        });
      });

      script.run({
        input: (await fs.readFileAsync(input)).toString(),
        user_out: (await fs.readFileAsync(user_out)).toString(),
        answer: (await fs.readFileAsync(answer)).toString(),
        task: task
      });
    });

    if (typeof result !== 'object') {
      throw {
        type: 'Special Judge returned result is not an object'
      };
    }

    if (typeof result.score !== 'number' || !(result.score >= 0 && result.score <= 100)) {
      throw {
        type: 'Special Judge returned result contains an illegal score'
      };
    }

    if (!result.message) result.message = '';
    if (typeof result.message !== 'string') result.message = JSON.stringify(result.message);

    result.success = true;
    return result;
  } catch (e) {
    if (e.type) {
      let errMessage = 'Special Judge Error: ' + e.type;
      if (e.err) errMessage += '\n\n' + e.err;
      return {
        success: false,
        score: 0,
        message: errMessage
      };
    } else {
      return {
        success: false,
        score: 0,
        message: 'Special Judge Unknown Error: ' + e
      };
    }
  }
}

module.exports = runSpecialJudge;
