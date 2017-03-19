let path = require('path');
let fs = require('fs');
let randomstring = require("randomstring");

function getLanguageModel(language) {
  try {
    return require('./languages/' + language);
  } catch (e) {
    return null;
  }
}

async function compile(code, language) {
  let srcFile = path.join(config.tmp_dir, language.getFilename(`tmp_${randomPrefix}_${randomstring.generate()}`));
  await fs.writeFileAsync(srcFile, code);
  let result = await language.compile(srcFile);
  return result;
}

module.exports = [
  getLanguageModel,
  compile
];
