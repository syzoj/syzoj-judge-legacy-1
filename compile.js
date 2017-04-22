let child_process = require('child_process');

function getLanguageModel(language) {
  try {
    let lang = require('./languages/' + language);
    lang.name = language;
    return lang;
  } catch (e) {
    return null;
  }
}

async function compile(code, language) {
  return new Promise((resolve, reject) => {
    let cp = child_process.fork('./compile_process.js');
    cp.send({
      code: code,
      lang: language.name,
      randomPrefix: randomPrefix
    });

    let returned = false;
    cp.on('message', res => {
      resolve(res);
      returned = true;
    });

    cp.on('error', err => {
      reject(err);
      returned = true;
    });

    cp.on('close', (code, signal) => {
      if (!returned) reject({ code: code, signal: signal });
    });
  });
}

module.exports = [
  getLanguageModel,
  compile
];
