/**
 * Copyright 2017 Google Inc. All rights reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
const fs = require('fs');
const path = require('path');
const SimpleServer = require('./server/SimpleServer');
const GoldenUtils = require('./golden-utils');
const GOLDEN_DIR = path.join(__dirname, 'golden');
const OUTPUT_DIR = path.join(__dirname, 'output');
const {TestRunner, Reporter, Matchers} = require('../utils/testrunner/');


const {helper} = require('../lib/helper');
if (process.env.COVERAGE)
  helper.recordPublicAPICoverage();

const PROJECT_ROOT = fs.existsSync(path.join(__dirname, '..', 'package.json')) ? path.join(__dirname, '..') : path.join(__dirname, '..', '..');
const puppeteer = require(PROJECT_ROOT);

const YELLOW_COLOR = '\x1b[33m';
const RESET_COLOR = '\x1b[0m';

const headless = (process.env.HEADLESS || 'true').trim().toLowerCase() === 'true';
const executablePath = process.env.CHROME;

if (executablePath)
  console.warn(`${YELLOW_COLOR}WARN: running tests with ${executablePath}${RESET_COLOR}`);
// Make sure the `npm install` was run after the chromium roll.
console.assert(fs.existsSync(puppeteer.executablePath()), `Chromium is not Downloaded. Run 'npm install' and try to re-run tests`);

const slowMo = parseInt((process.env.SLOW_MO || '0').trim(), 10);
const defaultBrowserOptions = {
  executablePath,
  slowMo,
  headless,
  args: ['--no-sandbox', '--disable-dev-shm-usage']
};

let parallel = 1;
if (process.env.PPTR_PARALLEL_TESTS)
  parallel = parseInt(process.env.PPTR_PARALLEL_TESTS.trim(), 10);
const parallelArgIndex = process.argv.indexOf('-j');
if (parallelArgIndex !== -1)
  parallel = parseInt(process.argv[parallelArgIndex + 1], 10);
require('events').defaultMaxListeners *= parallel;

const timeout = slowMo ? 0 : 10 * 1000;
const runner = new TestRunner({timeout, parallel});
new Reporter(runner);
const {beforeAll, beforeEach, afterAll, describe, xit, it} = runner;
const {expect} = new Matchers({
  toBeGolden: GoldenUtils.compare.bind(null, GOLDEN_DIR, OUTPUT_DIR)
});

if (fs.existsSync(OUTPUT_DIR))
  rm(OUTPUT_DIR);

console.log('Testing on Node', process.version);

beforeAll(async state  => {
  const assetsPath = path.join(__dirname, 'assets');
  const cachedPath = path.join(__dirname, 'assets', 'cached');

  const port = 8907 + state.parallelIndex * 2;
  state.server = await SimpleServer.create(assetsPath, port);
  state.server.enableHTTPCache(cachedPath);
  state.server.PREFIX = `http://localhost:${port}`;
  state.server.CROSS_PROCESS_PREFIX = `http://127.0.0.1:${port}`;
  state.server.EMPTY_PAGE = `http://localhost:${port}/empty.html`;

  const httpsPort = port + 1;
  state.httpsServer = await SimpleServer.createHTTPS(assetsPath, httpsPort);
  state.httpsServer.enableHTTPCache(cachedPath);
  state.httpsServer.PREFIX = `https://localhost:${httpsPort}`;
  state.httpsServer.CROSS_PROCESS_PREFIX = `https://127.0.0.1:${httpsPort}`;
  state.httpsServer.EMPTY_PAGE = `https://localhost:${httpsPort}/empty.html`;
});

beforeEach(async({server, httpsServer}) => {
  server.reset();
  httpsServer.reset();
});

afterAll(async({server, httpsServer}) => {
  await Promise.all([
    server.stop(),
    httpsServer.stop(),
  ]);
});

const testFiles = [
  'page.spec.js',
  'puppeteer.spec.js'
];

testFiles
    .map(file => path.join(__dirname, file))
    .forEach(file =>
      require(file).addTests({
        testRunner: runner,
        expect,
        defaultBrowserOptions,
        puppeteer,
        PROJECT_ROOT
      })
    );

if (process.env.COVERAGE) {
  describe('COVERAGE', function(){
    const coverage = helper.publicAPICoverage();
    const disabled = new Set(['page.bringToFront']);
    if (!defaultBrowserOptions.headless)
      disabled.add('page.pdf');

    for (const method of coverage.keys()) {
      (disabled.has(method) ? xit : it)(`public api '${method}' should be called`, async({page, server}) => {
        expect(coverage.get(method)).toBe(true);
      });
    }
  });
}

if (process.env.CI && runner.hasFocusedTestsOrSuites()) {
  console.error('ERROR: "focused" tests/suites are prohibitted on bots. Remove any "fit"/"fdescribe" declarations.');
  process.exit(1);
}
runner.run();
