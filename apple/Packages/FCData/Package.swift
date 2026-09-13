// swift-tools-version: 5.9

import PackageDescription

// FCData is the I/O layer: the Sleeper client, the disk cache, the static
// nflverse file store and the optional relay. Everything here can fail, go
// stale, or be offline — which is exactly why none of it lives in FCCore.
//
// Step 2 of the build order in docs/IOS_PORT_BRIEF.md §11.
let package = Package(
    name: "FCData",
    platforms: [
        .iOS(.v17),
        .macOS(.v14),
    ],
    products: [
        .library(name: "FCData", targets: ["FCData"]),
    ],
    dependencies: [
        .package(path: "../FCCore"),
    ],
    targets: [
        .target(name: "FCData", dependencies: ["FCCore"]),
        .testTarget(
            name: "FCDataTests",
            dependencies: ["FCData", "FCCore"],
            // Real shipped JSON, same reasoning as FCCore: the dialect traps in
            // §3.2 are exactly what a mock would paper over.
            resources: [.copy("Fixtures")]
        ),
    ]
)
