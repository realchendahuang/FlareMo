const VERSION_PATTERN =
  /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/;

export function compareVersions(left: string, right: string): number {
  const leftVersion = parseVersion(left);
  const rightVersion = parseVersion(right);
  if (!leftVersion || !rightVersion) {
    return left.localeCompare(right);
  }

  for (let index = 0; index < 3; index += 1) {
    const difference = leftVersion.numbers[index] - rightVersion.numbers[index];
    if (difference !== 0) return Math.sign(difference);
  }

  if (leftVersion.prerelease === rightVersion.prerelease) return 0;
  if (!leftVersion.prerelease) return 1;
  if (!rightVersion.prerelease) return -1;
  return leftVersion.prerelease.localeCompare(rightVersion.prerelease);
}

function parseVersion(version: string) {
  const match = VERSION_PATTERN.exec(version.replace(/^v/, ""));
  if (!match) return null;
  return {
    numbers: [Number(match[1]), Number(match[2]), Number(match[3])],
    prerelease: match[4] ?? "",
  };
}
