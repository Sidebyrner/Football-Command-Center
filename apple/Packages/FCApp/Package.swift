// swift-tools-version: 5.9

import PackageDescription

// FCApp is the SwiftUI layer: screens, their view models, and the composition
// that turns FCData reads into something FCCore can compute on.
//
// It is a library rather than the app target itself so that the view models are
// reachable from `swift test` without a simulator. The app target is a thin
// shell that imports this.
//
// Step 3 of the build order in docs/IOS_PORT_BRIEF.md §11.
let package = Package(
    name: "FCApp",
    platforms: [
        .iOS(.v17),
        .macOS(.v14),
    ],
    products: [
        .library(name: "FCApp", targets: ["FCApp"]),
    ],
    dependencies: [
        .package(path: "../FCCore"),
        .package(path: "../FCData"),
    ],
    targets: [
        .target(name: "FCApp", dependencies: ["FCCore", "FCData"]),
        .testTarget(
            name: "FCAppTests",
            dependencies: ["FCApp", "FCCore", "FCData"],
            resources: [.copy("Fixtures")]
        ),
    ]
)
