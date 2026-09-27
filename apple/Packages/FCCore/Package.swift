// swift-tools-version: 5.9

import PackageDescription

// FCCore is deliberately I/O-free: pure value types and algorithms, no
// networking, no SwiftUI, no file system. That is what lets the whole domain be
// tested against the real shipped data files without a simulator — see
// docs/IOS_PORT_BRIEF.md §2 and §10.
let package = Package(
    name: "FCCore",
    platforms: [
        .iOS(.v17),
        .macOS(.v14),
    ],
    products: [
        .library(name: "FCCore", targets: ["FCCore"]),
    ],
    targets: [
        .target(name: "FCCore"),
        .testTarget(
            name: "FCCoreTests",
            dependencies: ["FCCore"],
            // The real nflverse-derived files, not mocks. Mocks would have
            // passed while the dialect mismatches documented in §3.2 sailed
            // through.
            resources: [.copy("Fixtures")]
        ),
    ]
)
