# AI Clip Studio — Development Journal

This is the build log for AI Clip Studio, a local-first video clipping studio
with smart reframing, captions, and FFmpeg exports.

**Total time spent:** more than 16 hours — roughly 18 hours across planning,
backend work, frontend work, testing, debugging, and release preparation.

I did not track every minute, so the numbers below are rounded estimates. Some
sessions ran together and some time was spent waiting for renders, reinstalling
packages, or retesting the same clip with different settings.

## Time breakdown

| Work | Estimated time |
| --- | ---: |
| Reading the existing codebase and planning the reframing feature | 1.5 h |
| Building the local analysis engine | 4.5 h |
| Smoothing, quality scoring, and caching | 2.0 h |
| Dynamic FFmpeg crop rendering | 3.0 h |
| API routes, schemas, and frontend types | 1.5 h |
| Clip editor UI and quality report | 2.0 h |
| Removing unwanted dashboard/import/settings sections | 1.5 h |
| Testing, debugging, and checking existing data | 2.0 h |
| README, screenshots, cover, license, and privacy audit | 2.5 h |
| **Total** | **~18.5 h** |

---

## 2026-11-08 — Starting from the existing app (~1.5 h)

I started with an existing FastAPI + SQLAlchemy + React app that could already
import video, extract audio, transcribe it, analyze the transcript, caption
clips, and render them with FFmpeg.

The problem was framing. Every clip used a fixed crop. That is fine for a
centered talking-head video, but it destroys anything where the subject moves,
where there are two people, or where the important part of the frame is not in
the middle.

Before writing code I mapped the existing pipeline:

1. Import and probe the source video.
2. Extract mono audio.
3. Transcribe and store word timings.
4. Analyze the transcript and create clip candidates.
5. Edit the clip in the React UI.
6. Render the clip with FFmpeg.
7. Export the result.

I decided not to rebuild the app. The existing data model, API contracts, and UI
were already useful, and rebuilding would risk breaking existing projects. The
reframing feature needed to fit into the render step without changing how the
rest of the app worked.

I also checked the installed Python packages. OpenCV and NumPy were already
available, so I could build the analysis locally without adding a paid vision
API or another heavy dependency.

---

## 2026-11-08 — Designing the reframing engine (~1.0 h)

I split the feature into two separate parts:

- **Analysis:** look at the source clip and decide where the subject is over
  time.
- **Rendering:** turn that subject path into an FFmpeg crop expression.

Keeping those separate was important. The analysis is the expensive part, and it
should not run again every time the user changes a caption style or re-renders
the same clip. The render step should be able to reuse a cached plan.

The plan was:

1. Sample frames from the source clip at a fixed interval.
2. Detect faces with Haar cascades.
3. Track motion with frame differences.
4. Estimate saliency and text-like regions as fallbacks.
5. Classify the content type.
6. Build a subject path.
7. Smooth the path.
8. Score the result and warn the user when the crop is risky.
9. Cache the plan as JSON.

I also listed the crop modes I wanted to expose:

- Smart Reframe
- Motion Track
- Active Speaker
- Gameplay Focus
- Screen Focus
- Fit Original
- Face Aware
- Center
- Manual
- Blurred Pad

Some of these share code internally, but exposing them separately gives the user
a useful override when the automatic choice is wrong.

---

## 2026-11-08 — Building the local analysis engine (~4.5 h)

This was the biggest part of the project.

I added `backend/services/reframing/engine.py`. The engine samples frames from
the source clip using OpenCV instead of decoding every frame. Sampling every
frame would be slower and would not improve the result much, because the crop
path is smoothed anyway.

For each sampled frame it collects:

- face boxes and confidence
- motion energy
- saliency estimates
- text-like regions
- frame dimensions and timestamps
- a content classification clue

Face detection uses Haar cascades because they are available in the standard
OpenCV package and do not require a model download. They are not perfect, but
they are fast and good enough for the common talking-head and interview cases.

Motion is measured with frame differences. This helps when there is no clear
face, such as gameplay, sports, or a person walking through the frame.

Saliency is used as a fallback when the face detector loses the subject. The
goal is not to be perfect. The goal is to make a sensible decision and avoid
freezing the crop in the wrong place.

I also added a simple content classifier. It looks at the analysis signals and
chooses a likely category:

- talking head
- podcast
- interview
- vlog
- gaming
- screen recording
- entertainment
- general

The category influences the default crop mode. For example, gameplay should
favor motion and saliency, while a screen recording should often use a fitted
layout instead of a hard crop.

Once the raw subject positions were available, I normalized them to 0–1 so the
rest of the code would not depend on the source resolution. That made the crop
math much easier to test.

---

## 2026-11-08 — Smoothing, quality scoring, and caching (~2.0 h)

The first version of the crop path was technically correct but visually bad. It
jittered whenever the face detector lost the subject for a frame. A single bad
detection could make the crop jump across the frame.

I fixed this with three layers:

1. **Temporal smoothing** so the crop follows the general direction of the
   subject instead of every single detection.
2. **Velocity clamping** so the crop cannot move faster than a reasonable limit.
3. **A dead zone** so tiny movements do not move the crop at all.

The dead zone was the most important change. It made the result feel calm
instead of nervous.

I also added a quality report. The report includes:

- subject visibility
- face visibility
- crop stability
- caption-overlap risk
- whether the selected layout is likely to cut off important information
- a recommendation when the result is risky

This matters because a smart crop can still be wrong. Instead of pretending the
result is always perfect, the UI can tell the user when to check the clip
manually.

The analysis plan is cached as JSON. The cache key includes the source file and
the settings that affect the result. Re-rendering the same clip with the same
analysis does not repeat the OpenCV pass.

---

## 2026-11-08 — Turning the subject path into FFmpeg crops (~3.0 h)

I added `backend/services/cropping.py` and connected it to
`backend/services/rendering.py`.

The render step needed to support two kinds of crops:

- a static crop, where the crop box stays in one place
- a dynamic crop, where the crop box follows the subject over time

For the dynamic case, I generate an FFmpeg crop expression that changes with
time. The expression is clamped so the crop never goes outside the source frame.
The crop width and height are calculated from the target aspect ratio, not
hardcoded.

The math was more annoying than expected:

- The source can be 16:9, 4:3, vertical, or something unusual.
- The target can be 9:16, 16:9, 1:1, 4:5, or original.
- The subject position is normalized, but FFmpeg needs pixels.
- The crop box must stay inside the frame even when the subject is near an edge.
- The expression must behave correctly when the clip is short.

I also added fallback layouts. If a hard crop would cut off too much important
information, the renderer can use:

- a centered crop
- a fitted original frame
- a blurred background behind a fitted frame

The blurred-background layout was important for screen recordings and wide
shots. Cropping a screen recording to 9:16 usually destroys the UI. Fitting the
whole frame and filling the empty space with a blurred copy keeps the content
readable.

I tested a smart-crop render at 480×854. Seeing the crop move with the subject
instead of sitting still was the point where the feature finally felt real.

---

## 2026-11-09 — API, schemas, and frontend types (~1.5 h)

I added the analysis endpoint:

```text
POST /api/clips/{clip_id}/reframe/analyze
```

The endpoint runs the analysis, stores the plan, and returns the quality report.
It does not render the clip. That separation means the user can analyze first,
inspect the result, and then render.

I also updated the backend schemas and frontend TypeScript types for:

- the new crop modes
- the `reframe_plan` payload
- the quality report
- the analysis response

I kept the old crop modes working. Existing clips and existing render settings
should not break just because a new mode was added.

---

## 2026-11-09 — Clip editor UI and quality report (~2.0 h)

The backend was useless until the user could actually see what it decided.

I added an **Analyze reframe** button to the clip editor. While the analysis is
running, the button is disabled and shows progress. When it finishes, the editor
shows the quality report and lets the user choose a crop mode.

I also added a crop preview so the user can see the selected framing before
rendering. The preview uses the same crop data as the renderer, which helps avoid
the “the preview looked fine but the export was wrong” problem.

The quality report panel shows the important warnings without overwhelming the
user. If the subject is likely to leave the frame, or if captions might cover a
face, the report says so.

I deliberately did not add fake progress bars or fake analysis results. If the
analysis fails, the UI shows the failure. If a provider is missing, the UI says
so. Real progress is slower to build, but it is much easier to trust.

---

## 2026-11-09 — Removing unwanted UI sections (~1.5 h)

After using the app, I removed several sections that made the interface feel
cluttered and unfinished:

- Dashboard: removed the Pipeline Readiness, AI Providers, Local Storage, and
  Recent Activity panels.
- Import: removed the “What happens next”, privacy, and rights reminder panels.
- Settings: removed the provider catalog section.

I kept the dedicated Activity page. Recent activity still exists there; it just
does not need to be repeated on the dashboard.

I also checked that removing those panels did not remove any real functionality.
The provider settings, storage information, and job history are still available
where they belong.

---

## 2026-11-09 — Preserving existing data (~0.5 h)

I was careful not to delete existing projects or local media. The app had real
projects in its local storage, and the reframing work should not require a
database reset.

I verified that the existing project still loaded after the changes and that the
new analysis endpoint worked on a real clip.

Later, for the public release, I moved the hardcoded local paths out of the
public code and put them in an ignored `.env` file. That keeps the public repo
portable without breaking the existing local library.

---

## 2026-11-09 — Testing and debugging (~2.0 h)

I ran the backend smoke tests and the frontend build repeatedly while working.

The first test run had three passing tests and one skipped test. The skipped test
depended on a private sample video path, which is not something that should be
in a public repository. I replaced it with a small synthetic video generated by
FFmpeg inside the test. That made the test self-contained and removed a local
path and project ID from the repo.

After that change, all four backend tests passed.

I also ran the production frontend build after the UI cleanup. TypeScript
compilation and Vite both passed.

The manual checks included:

- health endpoint
- system info endpoint
- settings round trip
- upload and delete
- reframe analysis on a real clip
- smart-crop render at 480×854
- existing project loading
- frontend build

The hardest debugging was the FFmpeg filter graph. A small mistake in the crop
expression can produce a render that looks fine for the first second and then
breaks when the subject moves. I tested with different source sizes and target
aspect ratios before trusting the result.

---

## 2026-11-09 — Release preparation, README, and screenshots (~2.5 h)

Once the feature worked, I prepared the repo for a public release.

This included:

- expanding `.gitignore` for Python, frontend, storage, database, log, and test
  artifacts
- checking `.env.example` for real API keys — there were only placeholders
- adding a portable storage default
- adding an FFmpeg setup guide
- adding the OpenCV and NumPy requirements
- adding an MIT license
- rewriting the README with features, setup, privacy, troubleshooting, and
  limitations
- adding a `tools/README.md` for FFmpeg
- adding a `.gitattributes` file for line endings and binary assets

I also made fresh screenshots of the current UI. The old screenshots were
outdated and showed sections that had been removed.

For the screenshots I created a synthetic demo project with generated footage,
so no personal videos, project names, thumbnails, or transcripts would be
published. The screenshots show the real UI, but the content is demo content.

I created a cover image at `docs/cover.png` and added it to the README.

Finally, I did a privacy audit:

- checked tracked files for API keys and tokens
- checked for local paths
- checked for databases, videos, logs, and storage folders
- checked that `.env` was ignored
- checked that `node_modules` and `.venv` were ignored
- removed a test that referenced a private local video path and project ID

The repo now has no known credentials or private media in Git.

---

## What was hard

The hardest parts were:

1. **Smoothing without lag.** Too much smoothing makes the crop feel late. Too
   little makes it jitter. The dead zone and velocity clamp were the fix.
2. **Crop math.** Normalized coordinates are easy; keeping the crop inside the
   frame at every timestamp is not.
3. **FFmpeg expressions.** They are powerful but unforgiving. A small syntax or
   timing mistake can break the entire render.
4. **Fallback layouts.** A hard crop is not always the right answer. The blurred
   background layout took more work than expected, but it makes the feature much
   more useful for screen recordings and wide shots.
5. **Not faking progress.** It would have been easier to show a fake progress
   bar. Real background jobs and real error states took longer, but the result is
   honest.

## What I learned

- Local computer vision is good enough for a useful first pass if the fallback
  behavior is honest.
- Caching analysis separately from rendering makes the whole feature much more
  practical.
- A quality report is as important as the crop itself. Users need to know when
  the automatic result is risky.
- A public repo needs a privacy audit, not just a `.gitignore` file.
- Testing with synthetic media is better than committing a private sample video.

## What's next

- Test smart reframing on more real-world footage.
- Improve speaker switching for interviews and podcasts.
- Add more caption presets and export options.
- Make the quality report more specific about which frames are risky.
- Keep the app usable with local models and no paid provider.
