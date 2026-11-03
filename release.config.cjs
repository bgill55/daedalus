module.exports = {
  branches: [
    'main',
    { name: 'canary', prerelease: 'canary' }
  ],
  plugins: [
    '@semantic-release/commit-analyzer',
    '@semantic-release/release-notes-generator',
    '@semantic-release/changelog',
    '@semantic-release/npm',
    [
      '@semantic-release/git',
      {
        assets: ['package.json', 'package-lock.json', 'CHANGELOG.md'],
        message: 'chore(release): ${nextRelease.version}\n\n${nextRelease.notes}'
      }
    ],
    '@semantic-release/github',
    [
      '@semantic-release/exec',
      {
        successCmd: 'node ./src/discord/announceRelease.js --tag ${nextRelease.gitTag} --title "Daedalus Release ${nextRelease.gitTag}" --url "https://github.com/bgill55/daedalus/releases/tag/${nextRelease.gitTag}"'
      }
    ]
  ]
};
