# Bulk paste: entering shows from a text file

A quick way to enter shows from a venue's calendar or an Instagram post until the admin pages exist. Write the shows in a plain text file, check what will happen with a dry run, then commit.

```sh
pnpm shows:paste shows.txt            # dry run: prints what it would do, writes nothing
pnpm shows:paste shows.txt --commit   # writes it all in one transaction
```

It uses `DATABASE_URL_SESSION` from the repo-root `.env`, like `pnpm db:seed`. The file path is relative to where you run the command.

## Example

```
# Lines starting with # are comments. Blank lines are ignored.
@the-echo
source https://www.theecho.com/calendar

Fri Oct 9 | 9pm | doors 8pm | The Lagoons (band), Paper Moons, DJ Soft Serve (dj) | $15 presale, $20 door | 21+ | https://tickets.example.com/lagoons
Sat Oct 10 | 1am | Night Shift (dj) | free | 21+
Sun Oct 11 | 7:30pm | "Crosby, Stills & Nosh" (cover) | $10
Thu 10/15 | TBA | Open Mic Night (solo) | free | all ages

@zebulon
Fri Oct 16 | 10pm | Some Band, Another Band | $12 adv, $15 door
```

## The format

**`@venue-slug`** starts a block. Every show below it is at that venue, until the next `@` line. Use the venue's slug, as in its URL (`/v1/venues/the-echo`).

**`source <url>`** (optional, after an `@` line) is where you copied the listings from. It's stored with each show so the site can link back to it. It applies until the next `@` line.

**One show per line**, fields separated by `|`:

| Field | Required | Examples | Notes |
| --- | --- | --- | --- |
| Date | yes, first | `Fri Oct 9`, `Friday October 9`, `Oct 9`, `10/9`, `10/9/26`, `2026-10-09` | Without a year, the next Oct 9 from today (dates up to 30 days ago count as this year). If you include a weekday, it must match the date, which catches typos. |
| Start time | yes, second | `9pm`, `9:30pm`, `21:00`, `noon`, `midnight`, `TBA` | Venue local time. See [after midnight](#after-midnight). |
| Lineup | yes | `The Lagoons (band), Paper Moons, DJ Soft Serve (dj)` | Comma-separated, in billing order. |
| Doors | no | `doors 8pm` | |
| Prices | no | `$15 presale, $20 door`, `$12.50`, `free` | Comma-separated. A label after the amount is optional. `free` marks the show as free. |
| Age limit | no | `21+`, `18+`, `all ages` | |
| Ticket URL | no | `https://…` | |

After the date and start time, the other fields can come in any order. They're recognized by how they look: `doors …`, a `$` or `free`, an age, a URL. Anything else is the lineup, and a line may have only one lineup.

### Lineup

- List artists in billing order, separated by commas.
- Add a kind in parentheses after a name: `(band)`, `(dj)`, `(solo)` or `(cover)`. For new artists without one, `band` is assumed (with a warning). For existing artists the kind is already known.
- Put a name containing a comma in double quotes: `"Crosby, Stills & Nosh"`.
- Roles are set for you: DJs are `dj`, the first other act is the `headliner`, the rest are `support`.

### After midnight

Times are the venue's local time, and a night runs until 5am. A time from midnight to 4:59am belongs to the night of the date on the line. So `Sat Oct 10 | 1am | Night Shift (dj)` is the 1am set on **Saturday night** (technically Sunday morning). It's stored as Saturday's date with minutes 1500 (1440 + 60), and it's listed under Saturday. Doors work the same way: `doors 11pm` with a `1am` start is fine.

## What the dry run shows

A table per venue: line number, date, start and doors (`1:00 AM*`, where `*` marks after midnight), the lineup, prices, age, ticket host, and what will happen (`create`, `link`, `skip`). Lineup names carry markers:

- `[new band]`: no matching artist; one will be created.
- `[alias]`: matched an existing artist through one of its aliases.
- `[~0.82]`: matched an existing artist with a similar name (similarity 0.82).

Below the table:

**Errors** block `--commit` entirely, and nothing is written until they're fixed:
- a venue slug that doesn't exist (its shows are listed as not processed)
- a date or time it can't read, or a weekday that doesn't match the date
- a show with no lineup, or two lineup fields
- a lineup entry that looks like a time or price (`The Band, 10pm`: put `10pm` in its own field)
- a show line before any `@venue` line

**Warnings** don't block:
- each artist that will be created, and the kind it'll get
- names matched by alias or by similar spelling (shows which artist)
- names that are close to an existing artist, but not close enough to match automatically
- possible duplicates (below)
- lines already imported

## Matching artists

Each name is matched in this order:

1. **Slug**: `the lagoons` and `The Lagoons!` both match the artist with slug `the-lagoons`.
2. **Alias**: a case-insensitive match against the artist's `aliases`.
3. **Similar name**: trigram similarity of **0.7 or more** to an existing artist's name, picking the closest. This catches typos like `Sunset Strip Kidz`.
4. **Similar to a new artist earlier in the same paste** (same 0.7 rule), so a typo of a brand-new band on a later line (`The Lagoonz` after `The Lagoons`) doesn't create a second artist.
5. Otherwise a **new artist** is created.

The 0.7 threshold is deliberately strict. Band names are short, so a loose match would merge different acts (pg_trgm's default of 0.3 would treat "The Echo" and "The Ekho", at 0.5, as the same). Attaching a show to the wrong artist is worse than creating a duplicate artist, which can be merged later. Names between 0.4 and 0.7 get a warning naming the close match, so you can fix the spelling in the file instead.

## Duplicates and pasting twice

- **Pasting the same file again creates nothing.** Each show is stored as a `source_records` row whose id is a hash of its content (venue, date, times, lineup, prices, age, ticket URL), so an identical line is recognized and skipped.
- **An edited line for a show that's already in** (same venue and night, at least one artist in common) is **linked** to the existing event as another source. The event itself is **not changed**: fix existing events through admin edits (coming later), not by re-pasting.
- **The same show twice in one file** is created once. An identical second line is skipped; an overlapping one is linked to the first.

## What `--commit` writes

All of this happens in one transaction, so a failure leaves nothing behind:

- one shared `sources` row (kind `bulk_paste`, name `Bulk paste`), created on first use
- per show, a `source_records` row with the original line, the parsed show and its content hash
- per new show, an `events` row (`confirmed`, `checked` false, `last_verified_at` = now), plus its `event_artists`, `prices` and an `event_sources` link
- new `artists` as needed
