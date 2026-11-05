/** Classifies test paths using patterns adapted from Geld's Tests category. */
export function isTestPath(path: string): boolean {
  return (
    /(?:^|\/)(?:test|tests|__tests__|__test__|spec|specs|__mocks__|testdata|test-data|test_data|test-utils|test_utils|e2e|cypress|playwright|integration-tests|integration_tests|Tests|androidTest|testFixtures|__snapshots__)(?:\/|$)/.test(
      path,
    ) ||
    /(?:^|\/)(?:[^/]*\.snap|[^/]*\.test\.[^/]*|[^/]*_test\.[^/]*|test_[^/]*\.py|[^/]*_test\.py|(?:[^/]*\.spec|[^/]*_spec|[^/]*-spec)\.(?:[^/]*\.)*(?:js|jsx|ts|tsx|mjs|cjs|mts|cts|py|rb|go|rs|java|kt|kts|scala|groovy|php|cs|swift|dart|ex|exs)|[^/]*(?:Test|Tests)\.(?:java|kt|kts|scala|groovy|php|cs|swift|dart)|[^/]*Spec\.(?:java|kt|kts|scala|groovy|js|ts)|[^/]*IT\.java|[^/]*\.bats|[^/]*\.feature|[^/]*\.e2e\.[^/]*|[^/]*\.cy\.[^/]*|setupTests\.[^/]*|test-setup\.[^/]*|test_setup\.[^/]*|conftest\.py)$/.test(
      path,
    )
  );
}
