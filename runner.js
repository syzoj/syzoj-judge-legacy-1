let Sandbox = require('chroot-sandbox');
let sb = new Sandbox(parseInt(process.argv[2]) || 2333, [
  ['/usr/bin', '/usr/bin', true],
  ['/usr/share', '/usr/share', true],
  ['/usr/lib', '/usr/lib', true],
  ['/lib', '/lib', true],
  ['/lib64', '/lib64', true],
  ['/etc/alternatives/', '/etc/alternatives/', true],
  ['/dev', '/dev', true],
  ['/proc', '/proc', true],
]);

function runTestcase(task, language, execFile, extraFiles, testcase) {
  sb.reset();

  if (!task.file_io_input_name) task.file_io_input_name = 'data.in'
  if (!task.file_io_output_name) task.file_io_output_name = 'data.out'

  if (extraFiles) {
    for (let file of extraFiles) {
      if (typeof file === 'string') sb.put(file);
      else sb.put(file.filename, file.mask, file.targetFilename);
    }
  }

  sb.put(testcase.input, 777, task.file_io_input_name);

  let program = sb.put(execFile);

  let runOptions = {
    program: program,
    file_stdin: '',
    file_stdout: '',
    file_stderr: '',
    time_limit: Math.ceil(task.time_limit / 1000),
    time_limit_reserve: 1,
    memory_limit: task.memory_limit * 1024,
    memory_limit_reserve: language.minMemory + 32 * 1024,
    large_stack: language.largeStack,
    output_limit: Math.max(config.output_limit, language.minOutputLimit),
    process_limit: language.minProcessLimit,
    network: false
  };

  if (!task.file_io) {
    runOptions.file_stdin = task.file_io_input_name;
    runOptions.file_stdout = task.file_io_output_name;
  }

  let result = sb.run(runOptions);

  return {
    result: result,
    getOutputFile: () => {
      return sb.get(task.file_io_output_name);
    }
  };
}

function runForSpecialJudge (execFile, extraFiles, language) {
  sb.reset();

  // console.log(arguments);
  let program = sb.put(execFile);

  if (extraFiles) {
    for (let file of extraFiles) {
      if (typeof file === 'string') sb.put(file);
      else {
        if (typeof file.data !== 'undefined') {
          sb.put(Buffer.from(file.data), file.mask, file.targetFilename);
        } else {
          sb.put(file.filename, file.mask, file.targetFilename);
        }
      }
    }
  }

  let runOptions = {
    program: program,
    file_stdout: 'stdout',
    file_stderr: 'stderr',
    time_limit: Math.ceil(config.spj_time_limit / 1000),
    time_limit_reserve: 1,
    memory_limit: config.spj_time_limit * 1024,
    memory_limit_reserve: language.minMemory + 32 * 1024,
    large_stack: language.largeStack,
    output_limit: Math.max(config.spj_message_limit * 2, language.minOutputLimit),
    process_limit: language.minProcessLimit,
    network: false
  };

  return sb.run(runOptions);
}

module.exports = [
  sb,
  runTestcase,
  runForSpecialJudge
];
