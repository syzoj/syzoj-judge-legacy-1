let Promise = require('bluebird');
let fs = Promise.promisifyAll(require('fs'));
let path = require('path');
let url = require('url');
let AdmZip = require('adm-zip');
let request = require('request-promise');
let randomstring = require("randomstring");
let DockerSandbox = require('docker-sandbox');
let SandCastle = require('sandcastle').SandCastle;
let config = require('./config');

function getLanguageModel(language) {
  return require('./languages/' + language);
}

async function compile(code, language) {
  let srcFile = path.join(config.tmp_dir, language.getFilename('tmp_' + randomstring.generate()));
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
        res[s].score = parseInt(tokens[1]) || (100 / (lines.length - 2));
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

        //if (!list.includes(testcase.input)) throw `Can't find file ${testcase.input}`;
        //if (!list.includes(testcase.output)) throw `Can't find file ${testcase.output}`;
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

async function runTestcase(task, language, execFile, extraFiles, testcase) {
  async function getFileSize(file) {
    let stat = await fs.statAsync(file);
    return stat.size;
  }

  if (!task.file_io_input_name) task.file_io_input_name = 'data.in'
  if (!task.file_io_output_name) task.file_io_output_name = 'data.out'

  let inputData = (await fs.readFileAsync(testcase.input)).toString();

  // Remove all '\r'
  inputData = inputData.split('\r').join('');

  let inputFiles = [];
  inputFiles.push({
    name: task.file_io_input_name,
    mode: parseInt('444', 8),
    data: Buffer.from(inputData)
  });

  if (extraFiles) {
    for (let file of extraFiles) {
      inputFiles.push(file);
    }
  }

  let runOptions = {
    program: execFile,
    file_stdin: '',
    file_stdout: '',
    file_stderr: '',
    time_limit: Math.ceil(task.time_limit / 1000),
    time_limit_reserve: 1,
    memory_limit: task.memory_limit * 1024,
    memory_limit_reserve: language.minMemory + 32 * 1024,
    large_stack: language.largeStack,
    output_limit: Math.max((await getFileSize(testcase.output)) * 2, language.minOutputLimit),
    process_limit: language.minProcessLimit,
    input_files: inputFiles,
    output_files: [task.file_io_output_name]
  };

  if (!task.file_io) {
    runOptions.file_stdin = task.file_io_input_name;
    runOptions.file_stdout = task.file_io_output_name;
  }

  let runResult = await DockerSandbox(runOptions);
  return runResult;
}

async function runSpecialJudge(dir, input, user_out, answer) {
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

    let result = await new Promise((resolve, reject) => {
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
        input: input.toString(),
        user_out: user_out.toString(),
        answer: answer.toString()
      });
    });

    if (typeof result !== 'object') {
      throw {
        type: 'Special Judge returned result is not a object'
      };
    }

    if (typeof result.score !== 'number' || !(result.score >= 0 && result.score <= 100)) {
      throw {
        type: 'Special Judge returned result contains a illegal score'
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

function diff(buffer1, buffer2) {
  function splitLines(s) {
    return s.split('\r').join('').split('\n');
  }

  function normalizeLines(a) {
    while (a.length) {
      if (a[a.length - 1].trim() === '') a.pop();
      else break;
    }
    for (let i = 0; i < a.length; i++) {
      a[i] = a[i].trimRight();
    }
    return a;
  }

  let a1 = normalizeLines(splitLines(buffer1.toString())),
      a2 = normalizeLines(splitLines(buffer2.toString()));

  if (a1.length != a2.length) return false;
  else {
    for (let i = 0; i < a1.length; i++) {
      if (a1[i] !== a2[i]) return false;
    }
    return true;
  }
}

function shorterRead(buffer, maxLen) {
  let s = buffer.toString();
  if (s.length > maxLen) return s.substr(0, maxLen) + '...';
  else return s;
}

async function judgeTestcase(task, language, execFile, extraFiles, testcase) {
  let runResult = await runTestcase(task, language, execFile, extraFiles, testcase);

  let inputData = await fs.readFileAsync(testcase.input);
  let outputData = await fs.readFileAsync(testcase.output);

  let result = {
    status: '',
    time_used: parseInt(runResult.result.time_usage / 1000),
    memory_used: runResult.result.memory_usage,
    input: shorterRead(inputData, 120),
    user_out: '',
    answer: shorterRead(outputData, 120),
    score: 0
  };

  if (runResult.output_files[0]) {
    result.user_out = shorterRead(runResult.output_files[0].data, 120);
  }

  if (result.time_used > task.time_limit) {
    result.status = 'Time Limit Exceeded';
  } else if (result.memory_used > task.memory_limit * 1024) {
    result.status = 'Memory Limit Exceeded';
  } else if (runResult.result.status !== 'Exited Normally') {
    result.status = runResult.result.status;
  } else if (!runResult.output_files[0]) {
    result.status = 'File Error';
  } else {
    // AC or WA
    let spjResult = await runSpecialJudge(path.join(config.testdata_dir, task.testdata), inputData, runResult.output_files[0].data, outputData);
    if (spjResult === null) {
      // No Special Judge
      if (diff(outputData, runResult.output_files[0].data)) {
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
      result.spj_message = shorterRead(spjResult.message, config.spj_message_limit);
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
        result.status = 'Running on #' + (s + 1) + '・' + (caseNum + 1);
      }
      subtaskResult.pending = true;
      await callback(result);

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
          caseResult.score = caseResult.score / subtask.cases.length * (subtask.score / 100);
          subtaskScore = (subtaskScore || 0) + caseResult.score;
          break;
      }

      result.max_memory = Math.max(result.max_memory, caseResult.memory_used);
      result.total_time += caseResult.time_used;
      subtaskResult[caseNum++] = caseResult;

      if (!subtaskFinalStatus && caseResult.status !== 'Accepted') {
        subtaskFinalStatus = caseResult.status;
      }
    }
    subtaskResult.score = subtaskScore;
    if (subtaskFinalStatus) subtaskResult.status = subtaskFinalStatus;
    else subtaskResult.status = 'Passed';
    subtaskResult.pending = false;

    if (!overallFinalStatus && subtaskResult.status !== 'Passed') {
      overallFinalStatus = subtaskResult.status;
    }

    overallScore += subtaskResult.score;
    result.score = Math.min(100, Math.ceil(overallScore));
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

async function mainLoop() {
  while (1) {
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
  }
}

mainLoop();
