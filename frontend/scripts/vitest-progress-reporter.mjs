import { relative } from 'node:path';

const DEFAULT_INTERVAL_SECONDS = 60;

function intervalSeconds() {
  const seconds = Number.parseInt(process.env.WAVE_CI_PROGRESS_SECONDS ?? '', 10);
  return Number.isInteger(seconds) && seconds > 0 ? seconds : DEFAULT_INTERVAL_SECONDS;
}

function describeError(error) {
  const message = `${error.name ?? 'Error'}: ${error.message ?? String(error)}`;
  const parts = [message];
  if (error.diff) parts.push(error.diff);
  const frames = (error.stack ?? '').split('\n').filter((line) => line.trimStart().startsWith('at '));
  if (frames.length > 0) parts.push(frames.join('\n'));
  return parts.join('\n');
}

/** Prints a `Progress: <N>%` line of test files done at a fixed interval and each failure as it happens. */
export default class VitestProgressReporter {
  root = process.cwd();
  total = 0;
  done = new Set();
  reported = new Set();
  timer = undefined;

  onInit(vitest) {
    this.root = vitest.config.root;
  }

  onTestRunStart(specifications) {
    this.total = specifications.length;
    this.done.clear();
    this.reported.clear();
    clearInterval(this.timer);
    this.timer = setInterval(() => this.printProgress(), intervalSeconds() * 1000);
    this.timer.unref?.();
  }

  onTestCaseResult(testCase) {
    const result = testCase.result();
    if (result.state !== 'failed') return;
    const errors = result.errors.map(describeError).join('\n');
    this.write(`FAIL ${this.path(testCase.module.moduleId)} > ${testCase.fullName}\n${errors}\n`);
  }

  // The local frontend CI's stderr gate reads a test's console output, so pass it through unchanged.
  onUserConsoleLog(log) {
    const stream = log.type === 'stderr' ? process.stderr : process.stdout;
    stream.write(log.content.endsWith('\n') ? log.content : `${log.content}\n`);
  }

  onTestModuleEnd(testModule) {
    this.done.add(testModule.moduleId);
    this.printModuleErrors(testModule);
  }

  onTestRunEnd(testModules, unhandledErrors) {
    clearInterval(this.timer);
    this.timer = undefined;
    // Vitest skips onTestModuleEnd for a file that fails to load.
    for (const testModule of testModules) this.printModuleErrors(testModule);
    for (const error of unhandledErrors) {
      this.write(`Unhandled error\n${describeError(error)}\n`);
    }
  }

  printModuleErrors(testModule) {
    const errors = testModule.errors();
    if (errors.length === 0 || this.reported.has(testModule.moduleId)) return;
    this.reported.add(testModule.moduleId);
    this.write(`FAIL ${this.path(testModule.moduleId)}\n${errors.map(describeError).join('\n')}\n`);
  }

  printProgress() {
    const percent = this.total === 0 ? 0 : Math.floor((this.done.size * 100) / this.total);
    this.write(`Progress: ${percent}%\n`);
  }

  path(moduleId) {
    return relative(this.root, moduleId);
  }

  write(text) {
    process.stdout.write(text);
  }
}
