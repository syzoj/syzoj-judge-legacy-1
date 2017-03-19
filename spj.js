let Promise = require('bluebird');
let fs = Promise.promisifyAll(require('fs'));
let path = require('path');
let SandCastle = require('sandcastle').SandCastle;
let tmp = require('tmp');
let shellEscape = require('shell-escape');
let child_process = require('child_process');
let [sb, runTestcase, runForSpecialJudge] = require('./runner');
let [getLanguageModel, compile] = require('./compile');

function isFile(file) {
  try {
    let stat = fs.statSync(file);
    return stat.isFile();
  } catch (e) {
    return false;
  }
}

async function runLegacySpecialJudge (task, dir, input, user_out, answer) {
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

let spjCompileResult = null, spjLang = null;
function runNewSpecialJudge (task, dir, input, user_out, answer) {
  let extraFiles = JSON.parse(JSON.stringify(spjCompileResult.extraFiles || [])) || null;

  extraFiles.push({
    filename: input,
    targetFilename: 'input'
  });

  let tmpOutput = tmp.fileSync();
  child_process.execSync(shellEscape(['cp', '-r', user_out, tmpOutput.name]));
  extraFiles.push({
    filename: tmpOutput.name,
    targetFilename: 'user_out'
  });

  extraFiles.push({
    filename: answer,
    targetFilename: 'answer'
  });

  extraFiles.push({
    data: task.code,
    targetFilename: 'code'
  });

  let result = runForSpecialJudge(spjCompileResult.execFile, extraFiles, spjLang);

  tmpOutput.removeCallback();

  function readOutput (file) {
    let fileName = sb.get(file);
    if (!fileName) return '';
    return fs.readFileSync(fileName).toString().trim();
  }

  let stderr = readOutput('stderr');
  if (result.status !== 'Exited Normally') {
    return {
      success: false,
      score: 0,
      message: 'Special Judge Error: ' + result.status + (stderr ? ('\n\n' + stderr) : '')
    };
  } else {
    let scoreText = readOutput('stdout');
    let score = parseFloat(scoreText);
    if (score > 100 || score < 0 || !isFinite(score)) {
      return {
        success: false,
        score: 0,
        message: `Special Judge returned result contains an illegal score "${scoreText}"` + (stderr ? ('\n\n' + stderr) : '')
      };
    }
    return {
      success: true,
      score: score,
      message: stderr
    }
  }
}

async function runSpecialJudge (task, dir, input, user_out, answer) {
  if (spjCompileResult) {
    return runNewSpecialJudge(task, dir, input, user_out, answer);
  } else if (isFile(path.join(dir, 'spj.js'))) {
    return await runLegacySpecialJudge(task, dir, input, user_out, answer);
  }
  return null;
}

async function compileSpecialJudge (dir) {
  let files = fs.readdirSync(dir);
  for (let file of files) {
    let tmp = /^spj_([\S\s]+?)\.(?:[\S\s]+?)$/.exec(file);
    if (!tmp) continue;
    spjLang = getLanguageModel(tmp[1]);
    if (!spjLang) continue;

    return spjCompileResult = await compile(fs.readFileSync(path.join(dir, file)).toString(), spjLang);
  }

  return null;
}

module.exports = [
  compileSpecialJudge,
  runSpecialJudge
];
