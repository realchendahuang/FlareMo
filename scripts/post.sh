#!/usr/bin/env bash
# post.sh — post every unposted P01 queue entry to FlareMo as a PROTECTED memo.
#
# Reads P01's queue.json ($QUEUE_FILE) and this repo's posted.json ($POSTED_FILE).
# For each queue entry whose GitHub repo `id` is NOT already in posted.json:
#   - format a "Detailed" memo body
#   - POST $FLAREMO_URL/api/v1/memos with the two CF-Access headers
#     and {"content":"...","visibility":"protected"}   (lowercase — REST/Zod layer)
#   - on 2xx: append the entry to posted.json with memo_name + posted_at
#   - on non-2xx: print the body to stderr and exit 1 (stop the batch;
#     already-posted entries stay recorded, unposted ones stay in queue for next run)
#
# Never modifies $QUEUE_FILE — P01 owns it (overwrites weekly).
#
# Required env:
#   FLAREMO_URL, FLAREMO_ACCESS_CLIENT_ID, FLAREMO_ACCESS_CLIENT_SECRET,
#   QUEUE_FILE, POSTED_FILE
#
# Plan: plans/P02-private-feed-weekly-post.md (Step 3)
set -euo pipefail

: "${FLAREMO_URL:?FLAREMO_URL is required}"
: "${FLAREMO_ACCESS_CLIENT_ID:?FLAREMO_ACCESS_CLIENT_ID is required}"
: "${FLAREMO_ACCESS_CLIENT_SECRET:?FLAREMO_ACCESS_CLIENT_SECRET is required}"
: "${QUEUE_FILE:?QUEUE_FILE is required}"
: "${POSTED_FILE:?POSTED_FILE is required}"

# posted.json must exist as a JSON array (seeded by Step 2). Guard anyway.
if [ ! -f "$POSTED_FILE" ]; then
	printf '[]\n' >"$POSTED_FILE"
fi

# Empty queue → nothing to do (and jq -c '.[]' would emit nothing).
queue_len=$(jq 'length' "$QUEUE_FILE")
if [ "$queue_len" -eq 0 ]; then
	echo "queue empty; nothing to post"
	exit 0
fi

# Posted-id set (numeric GitHub repo id). Newline-separated for grep -xF.
posted_ids=$(jq -r '[.[].id] | map(tostring)' "$POSTED_FILE" | jq -r '.[]' | sort -u)

# Read queue entries into an array so the loop runs in THIS shell (exit 1 works).
mapfile -t entries < <(jq -c '.[]' "$QUEUE_FILE")

posted_count=0
for entry_json in "${entries[@]}"; do
	id=$(jq -r '.id' <<<"$entry_json")
	# Skip if already posted (dedup id = queue.id == posted.id).
	if printf '%s\n' "$posted_ids" | grep -xFq "$id"; then
		echo "skip (already posted): id=$id"
		continue
	fi

	full_name=$(jq -r '.full_name' <<<"$entry_json")

	# Build the "Detailed" memo body. description + topics are optional.
	memo_text=$(jq -r '
    def topics: if (.topics | length) > 0
                then "Topics: " + ([.topics[] | "#" + .] | join(" ")) + "\n"
                else "" end;
    "⭐ [\(.full_name)](\(.html_url))\n" +
    (if (.description // null) | . != null and . != ""
       then "\(.description)\n\n" else "" end) +
    "**Lang:** \(.language // "unknown") · **Stars:** \(.stargazers_count) · **Starred at:** \(.starred_at)\n" +
    topics
  ' <<<"$entry_json")

	# POST. Capture HTTP code + body separately.
	res_file=$(mktemp)
	trap 'rm -f "$res_file"' EXIT
	http_code=$(curl -sS -o "$res_file" -w "%{http_code}" \
		-X POST "$FLAREMO_URL/api/v1/memos" \
		-H "content-type: application/json" \
		-H "CF-Access-Client-Id: $FLAREMO_ACCESS_CLIENT_ID" \
		-H "CF-Access-Client-Secret: $FLAREMO_ACCESS_CLIENT_SECRET" \
		--data "$(jq -n --arg content "$memo_text" '{content: $content, visibility: "protected"}')")

	# Success is any 2xx (CreateMemo returns 201, not just 200).
	if [[ "$http_code" =~ ^2 ]]; then
		memo_name=$(jq -r '.name' "$res_file")
		posted_at=$(date -u +%Y-%m-%dT%H:%M:%SZ)
		new_entry=$(jq -n \
			--argjson entry "$entry_json" \
			--arg memo_name "$memo_name" \
			--arg posted_at "$posted_at" \
			'$entry + {memo_name: $memo_name, posted_at: $posted_at}')
		# Atomic append: jq reads → writes temp → mv over POSTED_FILE.
		tmp=$(mktemp)
		jq --argjson new "$new_entry" '. + [$new]' "$POSTED_FILE" >"$tmp" && mv "$tmp" "$POSTED_FILE"
		# Grow the in-memory set so a duplicate id later in this batch is skipped.
		posted_ids=$(printf '%s\n%s\n' "$posted_ids" "$id")
		posted_count=$((posted_count + 1))
		echo "posted: id=$id full_name=$full_name memo_name=$memo_name"
	else
		echo "FAIL: id=$id full_name=$full_name http=$http_code" >&2
		echo "body:" >&2
		cat "$res_file" >&2
		echo >&2
		exit 1
	fi
done

echo "done: posted $posted_count new memo(s) of $queue_len queue entries"
