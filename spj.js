let Promise = require('bluebird');
let fs = Promise.promisifyAll(require('fs'));
let path = require('path');
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
  }
  return null;
}

let LEGACY_SPECIAL_JUDGE_WRAPPER = `
function exit(obj) {
  process.stdout.write(String(obj.score));
  if (obj.message) process.stderr.write(String(obj.message));
  process.exit();
}

let fs = require('fs');
let input = fs.readFileSync('input').toString();
let user_out = fs.readFileSync('user_out').toString();
let answer = fs.readFileSync('answer').toString();
let code = fs.readFileSync('code').toString();
exports.main();
`
async function compileLegacySpecialJudge (code) {
  return await compile(code + '\n' + LEGACY_SPECIAL_JUDGE_WRAPPER, spjLang = getLanguageModel('nodejs'));
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

  if (files.includes('spj.js')) {
    return spjCompileResult = await compileLegacySpecialJudge(fs.readFileSync(path.join(dir, 'spj.js')).toString());
  }

  return null;
}

module.exports = [
  compileSpecialJudge,
  runSpecialJudge
];
