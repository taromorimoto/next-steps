# Changelog

## 0.13.1 – unreleased

- The text field no longer loses letters or moves the cursor while you type: the band no longer redraws, writing the text back, on every keystroke. Each turn gets a fresh, empty field.

## 0.13.0 – unreleased

- The checkboxes are numbered (1, 2, 3…, the text field's next in line); a filled one is picked. The terminal keeps ✓, its number shown as the hotkey.

## 0.12.1 – unreleased

- The text field sits on a row like a step's, with its own checkbox: typing checks it, unchecking keeps the words but leaves them out. It counts in **Send selected** and has no send button of its own.

## 0.12.0 – unreleased

- A free-text field under the steps: your own words are sent after the picked steps, or alone when none is picked. Enter sends. (Not in the mobile app, which draws no fields yet.)

## 0.11.1 – unreleased

- A question's replies get Claude's mark on one reply at most, and only one starts checked: listing options is no longer read as recommending them all.
- Rows without a marker keep its place, so every step's text starts in one column.

## 0.11.0 – unreleased

- A step Claude itself proposed or recommended in the conversation is marked with the Claude icon (✻ in the terminal) and starts checked; the band's own picks keep the star.
- When Claude did not end on a question, the last one or two steps are milestones (◎): a larger piece of the goal for Claude to drive on its own.

## 0.10.0 – unreleased

- When Claude ends a task with a question, the band shows the question and offers the replies Claude suggested as the choices, its recommendation starred, instead of generic next steps. This covers a question in Claude's text and one asked through a question box.

## 0.9.2 – unreleased

- On `auto`, the language of the suggested steps decides the labels and the "Do these next:" line, so a Finnish conversation no longer gets English after a short, pasted or English-looking prompt.
- Language guessing weighs common Finnish against common English words instead of calling any three words English.

## 0.9.1 – unreleased

- The hover wash covers the whole step row, the checkbox included, instead of a strip behind the text.
- Every step's text starts in the same column, starred or not.
- README: a screenshot of the band.

## 0.9.0 – 2026-11-07

- Click a step's text to pick it, not only its checkbox.
- The step row lights up under the pointer.
- Long steps wrap onto several lines, each line part of the click target.

## 0.8.1 – 2026-11-07

- Step rows always keep space between them, so the checkbox buttons no longer overlap.

## 0.8.0 – 2026-11-07

- Each step's checkbox is a button of its own, drawn full size with the surface's chrome, and the step's text beside it wraps instead of being cut short with an ellipsis.
- In a narrow window the Send and Close buttons go on a row of their own above the goal, so the goal gets the full width.

## 0.7.0 – 2026-11-07

- The band no longer shows the task's duration.
- The recommended star sits at the start of the step, right after the checkbox.
- When no goal or steps could be found, the band stays hidden instead of showing a lone Close button.

## 0.6.1 – 2026-11-07

- The duration moves beside the buttons as a compact dim time; the separate "Done" row is gone.
- Larger checkboxes on the desktop app.

## 0.6.0 – 2026-11-07

- Cleaner band: the goal is the title (◎, semibold) with the duration as a small line under it; checkboxes are colored, unpicked steps are dimmed, and the recommended star moves to the end of the row so every step lines up.
- No number chips on the desktop app; on the terminal 1–5 still toggle steps.

## 0.5.2 – 2026-11-07

- Send and Close sit in the band's top-right corner; the "Next steps" heading is gone.
- The band fits without scrolling: the space between step rows is dropped when it would not fit.
- Automatic language no longer falls back to English when the mod reloads during a turn.

## 0.5.1 – 2026-11-07

- More room between the step rows, and larger checkboxes where the surface sizes text (the desktop app).

## 0.5.0 – 2026-11-07

- The band leads with the session's goal (◎ Goal / Tavoite), read from the whole conversation by forking it, and kept stable from turn to turn unless the conversation clearly moves on.
- Suggested steps are chosen to move toward that goal.
- Falls back to the last request and answer when there is nothing to fork or the fork takes over 90 s.

## 0.4.0 – 2026-11-07

- `language` now defaults to `auto`: the labels follow the language of your request (Finnish or English), falling back to the system locale for very short prompts. `en` and `fi` still fix the language.

## 0.3.0 – 2026-11-07

- New `language` setting: `en` (default) or `fi` for Finnish labels. Set it in the `/config` menu, or with `claude plugin configure next-steps@next-steps --values-stdin`.
- README: how to switch the language.

## 0.2.0 – 2026-11-07

- Band labels in English: "Done · took 3m 12s", "Next steps", "Send selected", "Close"; picked steps are sent as "Do these next: …".
- Recommended steps are starred (★) and checked when they arrive, also after the mod reloads mid-generation.
- A generation cut off by a reload starts again; a failed or timed-out (90 s) Opus call shows the duration alone instead of a stuck loading line.
- Space between the step list and the buttons.
- Prefers a row under the answer where a surface draws transcript rows; falls back to the band above the prompt.

## 0.1.0 – 2026-11-07

- First version: task duration and 3–5 pickable next steps from Opus after every finished task.
