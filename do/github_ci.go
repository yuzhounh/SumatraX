package do

import (
	"encoding/json"
	"os"
)

const (
	githubEventTypeCodeQL = "codeql"
	githubEventPush       = "push"
	githubEventCron       = "schedule"
)

// "action": "build-pre-rel"
type gitHubEventJSON struct {
	Action string `json:"action"`
}

func getGitHubEventType() string {
	v := os.Getenv("GITHUB_EVENT_NAME")
	isWebhookDispatch := v == "repository_dispatch"
	if !isWebhookDispatch {
		return githubEventPush
	}
	path := os.Getenv("GITHUB_EVENT_PATH")
	d, err := os.ReadFile(path)
	must(err)
	var js gitHubEventJSON
	err = json.Unmarshal(d, &js)
	must(err)
	// validate this is an action we understand
	switch js.Action {
	case githubEventTypeCodeQL:
		return js.Action
	}
	panicIf(true, "invalid js.Action of '%s'", js.Action)
	return ""
}
