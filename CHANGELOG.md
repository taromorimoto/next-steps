# Changelog

## 0.3.0

- New `language` setting: `en` (default) or `fi` for Finnish labels. Set it in the `/config` menu, or with `claude plugin configure next-steps --values-stdin`.

## 0.2.0

- Band labels in English: "Done · took 3m 12s", "Next steps", "Send selected", "Close"; picked steps are sent as "Do these next: …".
- Recommended steps are starred (★) and checked when they arrive, also after the mod reloads mid-generation.
- A generation cut off by a reload starts again; a failed or timed-out (90 s) Opus call shows the duration alone instead of a stuck loading line.
- Space between the step list and the buttons.
- Prefers a row under the answer where a surface draws transcript rows; falls back to the band above the prompt.

## 0.1.0

- First version: task duration and 3–5 pickable next steps from Opus after every finished task.
