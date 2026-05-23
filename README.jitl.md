> OpenTUI [upstream](https://github.com/anomalyco/opentui) + experimental patchset for Node.js >=22 from [github.com/justjake/opentui](https://github.com/justjake/opentui) by [@jitl](https://twitter.com/jitl).
>
> - Support Node.js v22 (upstream requires Node.js v26's `node:ffi`).
> - Support React 18 (upstream requires React 19).
> - Support `require(ESM)` by removing top-level `await` expressions (upstream requires `await import(...)` in CommonJS modules).
> - `await writeReactToScrollback(renderer, <View />)` helper for split-footer mode.
> - `clearOnShutdown: false` preserves visible main-screen/split-footer content and scrollback on shutdown.
> - Changes to `split-footer` screen mode:
>
> ```typescript
> /**
>  * Choose whether writes to `stderr.write` join captured external output to
>  * stdout.
>  *
>  * - "auto": capture stderr only when external output capture is active and
>  *    stderr appears to write to stdout's destination.
>  * - "always": capture process.stderr whenever external output capture is active.
>  * - "never": leave stderr alone. (Upstream @opntui/core behavior)
>  * - WriteStream: capture the provided stream whenever external output capture
>  *   is active.
>  *
>  * Defaults to "auto".
>  */
> externalOutputCaptureStderr?: ExternalOutputCaptureStderr
>
> /**
>  * Choose how captured external output is rendered in split-footer mode.
>  *
>  * - "emulated": render captured output through OpenTUI layout engine. ANSI
>  *   color/style sequences are currently unhandled and produce rendering
>  *   artifacts (Upstream @opntui/core behavior).
>  * - "terminal-native": write captured output unmodified to its destination,
>  *   while accounting for its layout. This preserves terminal-native ANSI
>  *   behavior and wrapping, but some ANSI sequences may produce unexpected
>  *   behavior.
>  *
>  * Defaults to "terminal-native".
>  */
> externalOutputRendering?: ExternalOutputRendering
> ```
