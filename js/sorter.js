// Interactive merge sort
// -----------------------------------------------------------------------------
// Iterative bottom-up merge sort that asks the user to compare each required
// pair via nextPair()/answer(). Produces a full ordering with n*ceil(log2(n))
// comparisons in the worst case — much better than tournament brackets or the
// naive n² approach.
//
// Usage:
//   const sorter = new InteractiveMergeSort(items);
//   let pair;
//   while ((pair = sorter.nextPair())) {
//     const winner = await askUser(pair[0], pair[1]); // 'left' or 'right'
//     sorter.answer(winner);
//   }
//   const sorted = sorter.result(); // best -> worst

export class InteractiveMergeSort {
  constructor(items) {
    // Shuffle so the initial order doesn't bias the user's first few picks
    this.runs = items.map(i => [i]).sort(() => Math.random() - 0.5);
    this.tempRuns = [];
    this.runIdx = 0;
    this.left = null;
    this.right = null;
    this.merged = [];
    this.li = 0;
    this.ri = 0;
  }

  nextPair() {
    while (true) {
      if (this.left === null) {
        if (this.runIdx >= this.runs.length) {
          // End of pass — promote tempRuns to runs
          this.runs = this.tempRuns;
          this.tempRuns = [];
          this.runIdx = 0;
          if (this.runs.length <= 1) return null; // done
          continue;
        }
        if (this.runIdx + 1 >= this.runs.length) {
          // Odd one out — promote unchanged
          this.tempRuns.push(this.runs[this.runIdx]);
          this.runIdx++;
          continue;
        }
        this.left = this.runs[this.runIdx];
        this.right = this.runs[this.runIdx + 1];
        this.merged = [];
        this.li = 0;
        this.ri = 0;
        this.runIdx += 2;
      }

      if (this.li < this.left.length && this.ri < this.right.length) {
        return [this.left[this.li], this.right[this.ri]];
      }

      // Drain whichever side still has items
      while (this.li < this.left.length) this.merged.push(this.left[this.li++]);
      while (this.ri < this.right.length) this.merged.push(this.right[this.ri++]);
      this.tempRuns.push(this.merged);
      this.left = null;
    }
  }

  answer(winner) {
    if (winner === 'left') {
      this.merged.push(this.left[this.li++]);
    } else {
      this.merged.push(this.right[this.ri++]);
    }
  }

  result() {
    return this.runs[0] || [];
  }
}

// Upper-bound estimate used for progress bars.
export function estimateComparisons(n) {
  if (n < 2) return 1;
  const k = Math.ceil(Math.log2(n));
  return Math.max(1, n * k - Math.pow(2, k) + 1);
}
