let path = require('path');
let fs = require('fs');
let randomstring = require("randomstring");
let config = require('./config.json');

function getLanguageModel(language) {
  try {
    let lang = require('./languages/' + language);
    lang.name = language;
    return lang;
  } catch (e) {
    return null;
  }
}

async function compile(code, language, randomPrefix) {
  let srcFile = path.join(config.tmp_dir, language.getFilename(`tmp_${randomPrefix}_${randomstring.generate()}`));
  await fs.writeFileAsync(srcFile, code);
  let result = await language.compile(srcFile);
  return result;
}

process.setgid('nogroup');
process.setgroups(['nogroup']);
process.setuid('nobody');
process.env['TMPDIR'] = config.tmp_dir;
process.chdir(config.tmp_dir);

process.on('message', async msg => {
  let lang = getLanguageModel(msg.lang);
  let res = await compile(msg.code, lang, msg.randomPrefix);
  if (res.output && res.output.length > 10 * 1024) {
    res.output = res.output.substr(0, 10 * 1024) + '...';
  }
  process.send(res);
  process.exit();
});
