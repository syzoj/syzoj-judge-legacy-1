let Sandbox = require('chroot-sandbox');
let sb = new Sandbox([
  ['/usr/bin', '/usr/bin', true],
  ['/usr/share', '/usr/share', true],
  ['/usr/lib', '/usr/lib', true],
  ['/usr/lib64', '/usr/lib64', true],
  ['/lib', '/lib', true],
  ['/lib64', '/lib64', true],
  ['/dev', '/dev', true],
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

module.exports = [
  sb,
  runTestcase
];
