'use strict';

const fs = require('node:fs');
const fsp = fs.promises;
const { EventEmitter } = require('node:events');
const { downloadFile, fileSha1 } = require('./http');

/**
 * 并发下载队列：自动跳过已存在且 SHA1 正确的文件，汇总进度
 */
class DownloadQueue extends EventEmitter {
  constructor({ concurrency = 8, useMirror = true, phase = 'download' } = {}) {
    super();
    this.concurrency = Math.max(1, concurrency);
    this.useMirror = useMirror;
    this.phase = phase;
    this.tasks = [];
    this.bytes = new Map();
    this.completed = 0;
    this.failed = [];
    this.totalBytes = 0;
    this.aborted = false;
  }

  add(task) {
    if (!task || !task.url || !task.dest) return this;
    this.tasks.push(task);
    if (task.size) this.totalBytes += task.size;
    return this;
  }

  addAll(tasks) {
    for (const t of tasks) this.add(t);
    return this;
  }

  stop() {
    this.aborted = true;
  }

  emitProgress(current) {
    const bytesDone = Array.from(this.bytes.values()).reduce((a, b) => a + b, 0);
    this.emit('progress', {
      phase: this.phase,
      completed: this.completed,
      total: this.tasks.length,
      bytesDone,
      bytesTotal: Math.max(this.totalBytes, bytesDone),
      current: current || '',
    });
  }

  async processTask(task) {
    if (task.sha1) {
      try {
        const stat = await fsp.stat(task.dest);
        if (stat.isFile() && stat.size > 0) {
          const actual = await fileSha1(task.dest);
          if (actual.toLowerCase() === String(task.sha1).toLowerCase()) {
            this.bytes.set(task.dest, stat.size);
            return { skipped: true };
          }
        }
      } catch {
        // 文件不存在则继续下载
      }
    }
    const result = await downloadFile(task.url, task.dest, {
      sha1: task.sha1,
      size: task.size,
      useMirror: this.useMirror && task.useMirror !== false,
      onProgress: (p) => {
        this.bytes.set(task.dest, p.done);
        this.emitProgress(task.name || task.dest);
      },
    });
    this.bytes.set(task.dest, result.size || 0);
    return result;
  }

  async run() {
    this.emitProgress();
    let index = 0;
    const worker = async () => {
      while (!this.aborted) {
        const i = index++;
        if (i >= this.tasks.length) return;
        const task = this.tasks[i];
        try {
          await this.processTask(task);
        } catch (err) {
          this.failed.push({ ...task, error: err.message });
        } finally {
          this.completed++;
          this.emitProgress(task.name || task.dest);
        }
      }
    };
    const workers = Array.from({ length: Math.min(this.concurrency, this.tasks.length || 1) }, worker);
    await Promise.all(workers);
    return { total: this.tasks.length, completed: this.completed, failed: this.failed };
  }
}

module.exports = { DownloadQueue };
