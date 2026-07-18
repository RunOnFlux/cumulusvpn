//go:build tools

// This file exists only to keep golang.org/x/mobile in the module's dependency
// graph as a DIRECT requirement, so `gomobile bind` (build-{android,ios}.sh)
// works — gomobile refuses to run if x/mobile isn't a required dependency, and
// nothing else in this module imports it. The classic "tools.go" convention
// (works on every Go version, unlike the go1.24 `tool` directive, which gomobile
// doesn't reliably honor). It is never compiled into any real build (the `tools`
// build tag is never set).
package wgnest

import _ "golang.org/x/mobile/cmd/gobind"
