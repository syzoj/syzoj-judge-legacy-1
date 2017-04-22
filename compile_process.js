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

process.on('message', async msg => {
  let lang = getLanguageModel(msg.lang);
  let res = await compile(msg.code, lang, msg.randomPrefix);
  process.send(res);
});
