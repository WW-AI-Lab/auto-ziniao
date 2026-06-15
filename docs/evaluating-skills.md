# Evaluating skill output quality

> How to test whether your skill produces good outputs using eval-driven iteration.

Source: https://agentskills.io/skill-creation/evaluating-skills

You wrote a skill, tried it on a prompt, and it seemed to work. But does it work reliably — across varied prompts, in edge cases, better than no skill at all? Running structured evaluations (evals) answers these questions and gives you a feedback loop for improving the skill systematically.

## Designing test cases

A test case has three parts:

* **Prompt**: a realistic user message — the kind of thing someone would actually type.
* **Expected output**: a human-readable description of what success looks like.
* **Input files** (optional): files the skill needs to work with.

Store test cases in `evals/evals.json` inside your skill directory.

**Tips for writing good test prompts:**

* **Start with 2-3 test cases.** Don't over-invest before you've seen your first round of results.
* **Vary the prompts.** Use different phrasings, levels of detail, and formality.
* **Cover edge cases.** Include at least one prompt that tests a boundary condition.
* **Use realistic context.** Real users mention file paths, column names, and personal context.

Don't worry about defining specific pass/fail checks yet — just the prompts and expected outputs. You'll add detailed checks (called assertions) after you see what the first run produces.

## Running evals

The core pattern is to run each test case twice: once **with the skill** and once **without it** (or with a previous version). This gives you a baseline to compare against.

### Workspace structure

Organize eval results in a workspace directory alongside your skill directory. Each pass through the full eval loop gets its own `iteration-N/` directory. Within that, each test case gets an eval directory with `with_skill/` and `without_skill/` subdirectories.

### Spawning runs

Each eval run should start with a clean context — no leftover state from previous runs or from the skill development process. This ensures the agent follows only what the `SKILL.md` tells it.

### Capturing timing data

Timing data lets you compare how much time and tokens the skill costs relative to the baseline.

## Writing assertions

Assertions are verifiable statements about what the output should contain or achieve. Add them after you see your first round of outputs — you often don't know what "good" looks like until the skill has run.

Good assertions:

* `"The output file is valid JSON"` — programmatically verifiable.
* `"The bar chart has labeled axes"` — specific and observable.
* `"The report includes at least 3 recommendations"` — countable.

Weak assertions:

* `"The output is good"` — too vague to grade.
* `"The output uses exactly the phrase 'Total Revenue: $X'"` — too brittle.

## Grading outputs

Grading means evaluating each assertion against the actual outputs and recording **PASS** or **FAIL** with specific evidence.

### Grading principles

* **Require concrete evidence for a PASS.** Don't give the benefit of the doubt.
* **Review the assertions themselves, not just the results.** Notice when assertions are too easy, too hard, or unverifiable.

## Aggregating results

Once every run in the iteration is graded, compute summary statistics per configuration and save them to `benchmark.json`.

The `delta` tells you what the skill costs (more time, more tokens) and what it buys (higher pass rate).

## Analyzing patterns

Aggregate statistics can hide important patterns:

* **Remove or replace assertions that always pass in both configurations.**
* **Investigate assertions that always fail in both configurations.**
* **Study assertions that pass with the skill but fail without.**
* **Tighten instructions when results are inconsistent across runs.**
* **Check time and token outliers.**

## Reviewing results with a human

Assertion grading and pattern analysis catch a lot, but they only check what you thought to write assertions for. A human reviewer brings a fresh perspective.

Record specific feedback for each test case. "The chart is missing axis labels" is actionable; "looks bad" is not.

## Iterating on the skill

After grading and reviewing, you have three sources of signal:

* **Failed assertions** point to specific gaps.
* **Human feedback** points to broader quality issues.
* **Execution transcripts** reveal *why* things went wrong.

### The loop

1. Give the eval signals and current `SKILL.md` to an LLM and ask it to propose improvements.
2. Review and apply the changes.
3. Rerun all test cases in a new `iteration-<N+1>/` directory.
4. Grade and aggregate the new results.
5. Review with a human. Repeat.

Stop when you're satisfied with the results, feedback is consistently empty, or you're no longer seeing meaningful improvement between iterations.
