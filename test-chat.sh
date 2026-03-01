#!/usr/bin/env bash
# Test kitn chat service against all 3 models
# Usage: bash test-chat.sh

SERVICE="http://localhost:4002"

# Minimal registry index for context
REGISTRY='[
  {"name":"weather-tool","type":"kitn:tool","description":"Get weather data"},
  {"name":"weather-agent","type":"kitn:agent","description":"Weather assistant","registryDependencies":["weather-tool"]},
  {"name":"hackernews-tool","type":"kitn:tool","description":"Fetch HN stories"},
  {"name":"hackernews-agent","type":"kitn:agent","description":"HN assistant","registryDependencies":["hackernews-tool"]},
  {"name":"web-search-tool","type":"kitn:tool","description":"Search the web"},
  {"name":"web-search-agent","type":"kitn:agent","description":"Web search assistant","registryDependencies":["web-search-tool"]},
  {"name":"memory-store","type":"kitn:storage","description":"Persistent memory"},
  {"name":"memory-agent","type":"kitn:agent","description":"Memory assistant","registryDependencies":["memory-store"]},
  {"name":"cron-tools","type":"kitn:tool","description":"Cron management tools"},
  {"name":"cron-manager-agent","type":"kitn:agent","description":"Schedule tasks","registryDependencies":["cron-tools"]},
  {"name":"upstash-scheduler","type":"kitn:cron","description":"Upstash QStash scheduler"},
  {"name":"mcp-server","type":"kitn:package","description":"Expose as MCP server"},
  {"name":"hono","type":"kitn:package","description":"Hono HTTP adapter"}
]'
INSTALLED='["weather-tool","weather-agent"]'
METADATA="{\"registryIndex\":$REGISTRY,\"installed\":$INSTALLED}"

PASS=0
FAIL=0
RESULTS=()

# send_chat <model> <message> — returns JSON response
send_chat() {
  local model="$1"
  local message="$2"
  local payload
  payload=$(jq -n \
    --arg msg "$message" \
    --arg model "$model" \
    --argjson meta "$METADATA" \
    '{messages:[{role:"user",content:$msg}], metadata:$meta, model:$model}')
  curl -s -X POST "$SERVICE/api/chat" \
    -H "Content-Type: application/json" \
    -d "$payload"
}

# check <model> <label> <message> <expected_tool_or_text>
check() {
  local model="$1"
  local label="$2"
  local message="$3"
  local expect="$4"  # tool name (createPlan/askUser) or "text" or "rejected"

  local resp
  resp=$(send_chat "$model" "$message")

  local tool_names rejected content
  tool_names=$(echo "$resp" | jq -r '.message.toolCalls[]?.name // empty' 2>/dev/null)
  rejected=$(echo "$resp" | jq -r '.rejected // false' 2>/dev/null)
  content=$(echo "$resp" | jq -r '.message.content // empty' 2>/dev/null | head -c 80)

  local status="FAIL"
  local detail=""

  if [[ "$expect" == "rejected" ]]; then
    if [[ "$rejected" == "true" ]]; then
      status="PASS"
    else
      detail="expected rejection, got: tools=$(echo $tool_names | tr '\n' ',') text=$content"
    fi
  elif [[ "$expect" == "text" ]]; then
    if [[ -z "$tool_names" && "$rejected" != "true" && -n "$content" ]]; then
      status="PASS"
    else
      detail="expected plain text, got: tools=$(echo $tool_names | tr '\n' ',')"
    fi
  else
    if echo "$tool_names" | grep -q "$expect"; then
      status="PASS"
    else
      detail="expected tool=$expect, got: tools=$(echo $tool_names | tr '\n' ',') text=$content"
    fi
  fi

  local short_model="${model##*/}"
  local icon="✓"
  [[ "$status" == "FAIL" ]] && icon="✗"

  echo "  $icon [$short_model] $label"
  [[ -n "$detail" ]] && echo "      → $detail"

  if [[ "$status" == "PASS" ]]; then
    ((PASS++))
  else
    ((FAIL++))
  fi
  RESULTS+=("$status|$short_model|$label|$detail")
}

MODELS=(
  "deepseek/deepseek-chat-v3-0324"
  "openai/gpt-4o-mini"
  "z-ai/glm-4.7"
)

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo " kitn chat — 3-model test suite"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

for MODEL in "${MODELS[@]}"; do
  SHORT="${MODEL##*/}"
  echo "▶ $SHORT"

  # 1. Simple add (should use createPlan)
  check "$MODEL" "add hackernews-agent" \
    "Add the hackernews agent" \
    "createPlan"

  # 2. Dependency resolution (should add hackernews-tool + hackernews-agent)
  check "$MODEL" "add with dependency" \
    "I want to use HackerNews in my project" \
    "createPlan"

  # 3. Create custom tool (not in registry)
  check "$MODEL" "create custom tool" \
    "Create a Slack notification tool" \
    "createPlan"

  # 4. Vague request → should ask user
  check "$MODEL" "vague → askUser" \
    "I want to build an agent" \
    "askUser"

  # 5. Link tool to agent
  check "$MODEL" "link tool to agent" \
    "Link the hackernews-tool to the weather-agent" \
    "createPlan"

  # 6. Remove installed component
  check "$MODEL" "remove installed component" \
    "Remove the weather-tool from my project" \
    "createPlan"

  # 7. API key setup → updateEnv
  check "$MODEL" "API key setup" \
    "Configure my OpenAI API key" \
    "updateEnv"

  # 8. Informational query → plain text
  check "$MODEL" "informational → text" \
    "What components are available in the registry?" \
    "text"

  # 9. Off-topic → rejected
  check "$MODEL" "off-topic rejected" \
    "Write me a poem about clouds" \
    "rejected"

  # 10. Don't re-add installed
  check "$MODEL" "skip already installed" \
    "Add the weather-tool to my project" \
    "createPlan"

  echo ""
done

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo " Results: $PASS passed, $FAIL failed"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

if [[ $FAIL -gt 0 ]]; then
  echo ""
  echo "Failures:"
  for r in "${RESULTS[@]}"; do
    IFS='|' read -r status model label detail <<< "$r"
    if [[ "$status" == "FAIL" ]]; then
      echo "  ✗ [$model] $label"
      [[ -n "$detail" ]] && echo "    $detail"
    fi
  done
fi

exit $FAIL
