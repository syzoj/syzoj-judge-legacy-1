/*
 *  This file is part of SYZOJ.
 *
 *  Copyright (c) 2016 Menci <huanghaorui301@gmail.com>
 *
 *  SYZOJ is free software: you can redistribute it and/or modify
 *  it under the terms of the GNU Affero General Public License as
 *  published by the Free Software Foundation, either version 3 of the
 *  License, or (at your option) any later version.
 *
 *  SYZOJ is distributed in the hope that it will be useful,
 *  but WITHOUT ANY WARRANTY; without even the implied warranty of
 *  MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 *  GNU Affero General Public License for more details.
 *
 *  You should have received a copy of the GNU Affero General Public
 *  License along with SYZOJ. If not, see <http://www.gnu.org/licenses/>.
 */

let child_process = require('child_process');
let config = require('./config');

let i = parseInt(process.argv[2]) || 1;
if (config.threads > i) {
  let ch = child_process.exec(`node --harmony-async-await daemon.js ${i + 1}`);
  ch.stdout.pipe(process.stdout);
}

if (process.getuid() !== 0) {
  console.log('Need root privileges.');
  process.exit();
}

function start () {
  let obj = child_process.exec(`node --harmony-async-await judger.js ${2333 + i}`, start);
  obj.stdout.pipe(process.stdout);
}

start();
