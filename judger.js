#!/usr/bin/node --harmony-async-await

let Promise = require('bluebird');
let fs = Promise.promisifyAll(require('fs'));
let path = require('path');
let url = require('url');
let AdmZip = require('adm-zip');
let request = require('request-promise');
let randomstring = require("randomstring");
let child_process = require('child_process');
let shellEscape = require('shell-escape');
let config = require('./config');
let randomPrefix = randomstring.generate();

let runSpecialJudge = require('./spj');
let [sb, runTestcase] = require('./runner');

global.config = config;

function execute () {
  return child_process.execSync(shellEscape(Array.from(arguments)));
}

function getLanguageModel(language) {
  return require('./languages/' + language);
}

async function compile(code, language) {
  let srcFile = path.join(config.tmp_dir, language.getFilename(`tmp_${randomPrefix}_${randomstring.generate()}`));
  await fs.writeFileAsync(srcFile, code);
  let result = await language.compile(srcFile);
  return result;
}

async function getJudgeTask() {
  return new Promise(async (resolve, reject) => {
    let task;
    do {
      try {
        task = await request({
          uri: url.resolve(config.syzoj_url, '/api/waiting_judge'),
          qs: {
            'session_id': config.judge_token
          },
          json: true
        });
      } catch (e) {}

      await Promise.delay(config.delay);
    } while (!task || task.have_task === 0);

    resolve(task);
  });
}

async function parseTestdata(testdata) {
  let dir = path.join(config.testdata_dir, testdata);
  let dataRuleText;
  let res = [];
  let list = await fs.readdirAsync(dir);
  try {
    dataRuleText = await fs.readFileAsync(path.join(dir, 'data_rule.txt'));
  } catch (e) {
    // No data_rule.txt

    res[0] = {};
    res[0].cases = [];
    for (let file of list) {
      let parsedName = path.parse(file);
      if (parsedName.ext === '.in') {
        if (list.includes(`${parsedName.name}.out`)) {
          res[0].cases.push({
            input: path.join(dir, file),
            output: path.join(dir, `${parsedName.name}.out`)
          });
        }

        if (list.includes(`${parsedName.name}.ans`)) {
          res[0].cases.push({
            input: path.join(dir, file),
            output: path.join(dir, `${parsedName.name}.ans`)
          });
        }
      }
    }

    res[0].type = 'sum';
    res[0].score = 100;
    res[0].cases.sort((a, b) => {
      function getLastInteger(s) {
        let re = /(\d+)\D*$/;
        let x = re.exec(s);
        if (x) return parseInt(x[1]);
        else return -1;
      }

      return getLastInteger(a.input) - getLastInteger(b.input);
    });

    return res;
  }

  function parseDataRule(dataRuleText) {
    let lines = dataRuleText.split('\r').join('').split('\n').filter(x => x.length !== 0);

    if (lines.length < 3) throw 'Invalid data_rule.txt';

    let input = lines[lines.length - 2];
    let output = lines[lines.length - 1];

    for (let s = 0; s < lines.length - 2; ++s) {
      res[s] = {};
      res[s].cases = [];
      let numbers = lines[s].split(' ').filter(x => x);
      if (numbers[0].includes(':')) {
        let tokens = numbers[0].split(':');
        res[s].type = tokens[0] || 'sum';
        res[s].score = parseFloat(tokens[1]) || (100 / (lines.length - 2));
        numbers.shift();
      } else {
        res[s].type = 'sum';
        res[s].score = 100;
      }
      for (let i of numbers) {
        let testcase = {
          input: path.join(dir, input.replace('#', i)),
          output: path.join(dir, output.replace('#', i))
        };

        res[s].cases.push(testcase);
      }
    }

    return res.filter(x => x.cases && x.cases.length !== 0);
  }

  let dataRule = parseDataRule(dataRuleText.toString());
  return dataRule;
}

async function downloadTestData(testdata) {
  let zip = await request({
    uri: url.resolve(config.syzoj_url, '/static/uploads/' + testdata),
    encoding: null,
    transform: data => {
      return new AdmZip(data);
    }
  });

  let dir = path.join(config.testdata_dir, testdata);
  await fs.mkdirAsync(dir);
  zip.extractAllTo(dir);
}

async function getTestData(testdata) {
  if (!testdata) return null;

  try {
    async function isdir(path) {
      let stat;
      try {
        stat = await fs.statAsync(path);
        return stat.isDirectory();
      } catch (e) {
        return false;
      }
    }

    let dir = path.join(config.testdata_dir, testdata);
    if (!await isdir(dir)) {
      await downloadTestData(testdata);
    }
    return parseTestdata(testdata);
  } catch (e) {
    return null;
  }
}

function diff(filename1, filename2) {
  try {
    execute('diff', '-Bb', filename1, filename2);
    return true;
  } catch (e) {
    return false;
  }
}

function shorterRead(fileName, maxLen) {
  let fd = fs.openSync(fileName, 'r');
  let len = fs.fstatSync(fd).size;
  if (len > maxLen) {
    let buf = Buffer.allocUnsafe(maxLen);
    fs.readSync(fd, buf, 0, 120, 0);
    let res = buf.toString() + '...';
    fs.closeSync(fd);
    return res;
  } else {
    fs.closeSync(fd);
    return fs.readFileSync(fileName).toString();
  }
}

function shorterReadString(buffer, maxLen) {
  let s = buffer.toString();
  if (s.length > maxLen) return s.substr(0, maxLen) + '...';
  else return s;
}

async function judgeTestcase(task, language, execFile, extraFiles, testcase) {
  let runResult = await runTestcase(task, language, execFile, extraFiles, testcase);

  let result = {
    status: '',
    time_used: parseInt(runResult.result.time_usage / 1000),
    memory_used: runResult.result.memory_usage,
    input: shorterRead(testcase.input, 120),
    user_out: '',
    answer: shorterRead(testcase.output, 120),
    score: 0
  };

  let outputFile = runResult.getOutputFile();
  if (outputFile) {
    result.user_out = shorterRead(outputFile, 120);
  }

  if (result.time_used > task.time_limit) {
    result.status = 'Time Limit Exceeded';
  } else if (result.memory_used > task.memory_limit * 1024) {
    result.status = 'Memory Limit Exceeded';
  } else if (runResult.result.status !== 'Exited Normally') {
    result.status = runResult.result.status;
  } else if (!outputFile) {
    result.status = 'File Error';
  } else {
    // AC or WA
    let spjResult = await runSpecialJudge(task, path.join(config.testdata_dir, task.testdata), testcase.input, outputFile, testcase.output);
    if (spjResult === null) {
      // No Special Judge
      if (diff(testcase.output, outputFile)) {
        result.status = 'Accepted';
        result.score = 100;
      } else {
        result.status = 'Wrong Answer';
      }
    } else {
      result.score = spjResult.score;
      if (!spjResult.success) result.status = 'Judgement Failed';
      else if (spjResult.score === 100) result.status = 'Accepted';
      else if (spjResult.score === 0) result.status = 'Wrong Answer';
      else result.status = 'Partially Correct';
      result.spj_message = shorterReadString(spjResult.message, config.spj_message_limit);
    }
  }

  return result;
}

async function judge(task, callback) {
  let result = {
    status: '',
    score: 0,
    total_time: 0,
    max_memory: 0,
    case_num: 0,
    compiler_output: ''
  };

  result.status = 'Compiling';
  result.pending = true;
  await callback(result);

  // Compile the source code
  let language = getLanguageModel(task.language);
  let compileResult = await compile(task.code, language);
  result.compiler_output = compileResult.output;

  if (!compileResult.success) {
    result.status = 'Compile Error';
    result.pending = false;
    return await callback(result);
  }

  let dataRule = await getTestData(task.testdata);
  if (!dataRule) {
    result.status = 'No Testdata';
    result.pending = false;
    return await callback(result);
  }

  result.subtasks = [];
  for (let s = 0; s < dataRule.length; ++s) {
    result.subtasks[s] = {
      case_num: dataRule[s].cases.length,
      status: 'Waiting',
      pending: true
    };
  }

  let overallFinalStatus = null, overallScore = 0;
  result.score = 0;
  for (let s = 0; s < dataRule.length; ++s) {
    let subtask = dataRule[s];
    let subtaskResult = result.subtasks[s];
    let subtaskFinalStatus = null, subtaskScore = null;
    let caseNum = 0;
    for (let testcase of subtask.cases) {
      subtaskResult.status = 'Running on #' + (caseNum + 1);
      if (dataRule.length === 1) {
        result.status = 'Running on #' + (caseNum + 1);
      } else {
        result.status = 'Running on #' + (s + 1) + '.' + (caseNum + 1);
      }
      subtaskResult.pending = true;
      await callback(result);

      overallScore -= subtaskScore;
      result.score = Math.min(100, Math.ceil(overallScore));
      let caseResult = await judgeTestcase(task, language, compileResult.execFile, compileResult.extraFiles, testcase);

      switch (subtask.type) {
        case 'min':
          caseResult.score = caseResult.score * (subtask.score / 100);
          subtaskScore = Math.min((subtaskScore == null) ? subtask.score : subtaskScore, caseResult.score);
          break;
        case 'mul':
          subtaskScore = ((subtaskScore == null) ? subtask.score : subtaskScore) * (caseResult.score / 100);
          caseResult.score = caseResult.score * (subtask.score / 100);
          break;
        case 'sum': default:
          subtask.type = 'sum';
          caseResult.score = caseResult.score / subtask.cases.length * (subtask.score / 100);
          subtaskScore = (subtaskScore || 0) + caseResult.score;
          break;
      }

      overallScore += subtaskScore;
      result.score = Math.min(100, Math.ceil(overallScore));
      result.max_memory = Math.max(result.max_memory, caseResult.memory_used);
      result.total_time += caseResult.time_used;
      subtaskResult[caseNum++] = caseResult;

      if (!subtaskFinalStatus && caseResult.status !== 'Accepted') {
        subtaskFinalStatus = caseResult.status;
      }
    }
    subtaskResult.score = subtaskScore;
    if (subtaskFinalStatus) subtaskResult.status = subtaskFinalStatus;
    else subtaskResult.status = 'Accepted';
    subtaskResult.pending = false;

    if (!overallFinalStatus && subtaskResult.status !== 'Accepted') {
      overallFinalStatus = subtaskResult.status;
    }
  }

  if (overallFinalStatus) result.status = overallFinalStatus;
  else result.status = 'Accepted';
  result.pending = false;

  await callback(result);
}

async function uploadJudgeResult(task, result) {
  return await request({
    uri: url.resolve(config.syzoj_url, '/api/update_judge/' + task.judge_id),
    method: 'POST',
    body: {
      result: JSON.stringify(result)
    },
    qs: {
      session_id: config.judge_token
    },
    json: true
  });
}

async function main() {
  let task = await getJudgeTask();
  console.log(task);
  try {
    await judge(task, async result => {
      let uploadResult = await uploadJudgeResult(task, result);
    });
  } catch (e) {
    await uploadJudgeResult(task, {
      status: "System Error",
      score: 0,
      total_time: 0,
      max_memory: 0,
      case_num: 0,
      pending: false
    });
    console.log(e);
  }

  child_process.execSync('rm -rf ' + path.join(config.tmp_dir, `tmp_${randomPrefix}_*`));
  sb.destroy();
  process.exit()
}

main();
