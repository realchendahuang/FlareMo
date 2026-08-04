# Generated Memos protobuf descriptors

These TypeScript files are generated from the pinned upstream Memos proto
snapshot at `Temp/memos` commit
`daa71d0456d07a25ff5ea435e46577d31d030728`.

The source files were generated with `protoc-gen-es v2.12.0` and are checked
into the Worker because the Cloudflare Worker build does not run `protoc` at
deployment time. The runtime dependency is pinned to the same Buf protobuf
major/minor line in `apps/worker/package.json`.

When updating the upstream snapshot, regenerate the complete descriptor set,
review service and field additions, update this commit reference, and run the
generated runtime tests plus the full repository verification. Do not edit the
generated `.ts` files by hand, and do not commit the `Temp/` reference
checkout.
