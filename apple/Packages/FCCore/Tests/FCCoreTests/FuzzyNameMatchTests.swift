import XCTest
@testable import FCCore

final class FuzzyNameMatchTests: XCTestCase {
    private func matches(_ query: String, _ name: String, _ extra: [String] = []) -> Bool {
        FuzzyNameMatch.score(query: query, name: name, extra: extra) != nil
    }

    func testForgivesATypoInAnyWord() {
        XCTAssertTrue(matches("Cedric Grey", "Cedric Gray"))
        XCTAssertTrue(matches("bolten", "Nick Bolton"))
        XCTAssertTrue(matches("anthony hil", "Anthony Hill Jr."))
        XCTAssertTrue(matches("smtih", "D'Anthony Smith"), "adjacent swap counts once")
    }

    func testAnyOrderAndTeam() {
        XCTAssertTrue(matches("gray ten", "Cedric Gray", ["TEN", "Tennessee Titans"]))
        XCTAssertTrue(matches("titans gray", "Cedric Gray", ["TEN", "Tennessee Titans"]))
        XCTAssertFalse(matches("gray kc", "Cedric Gray", ["TEN", "Tennessee Titans"]))
    }

    func testPunctuationIsIgnored() {
        XCTAssertTrue(matches("danthony", "D'Anthony Smith"))
        XCTAssertTrue(matches("smith-njigba", "Jaxon Smith-Njigba"))
        XCTAssertTrue(matches("aj", "A.J. Brown"))
    }

    func testShortWordsMustBeExactOrPrefixes() {
        XCTAssertFalse(matches("gry", "Cedric Gray"), "no typo allowance under four letters")
        XCTAssertTrue(matches("gra", "Cedric Gray"))
        XCTAssertFalse(matches("xyz", "Cedric Gray"))
    }

    func testCloserMatchesScoreHigher() throws {
        let exact = try XCTUnwrap(FuzzyNameMatch.score(query: "gray", name: "Cedric Gray"))
        let typo = try XCTUnwrap(FuzzyNameMatch.score(query: "grey", name: "Cedric Gray"))
        let prefix = try XCTUnwrap(FuzzyNameMatch.score(query: "gra", name: "Cedric Gray"))
        XCTAssertGreaterThan(exact, prefix)
        XCTAssertGreaterThan(prefix, typo)
    }
}
