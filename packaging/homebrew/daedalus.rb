require "language/node"

class Daedalus < Formula
  desc "Local-first AI coding CLI with embedded model router and multi-agent orchestration"
  homepage "https://github.com/bgill55/daedalus"
  url "https://registry.npmjs.org/daedalus-cli/-/daedalus-cli-3.83.0.tgz"
  license "MIT"

  depends_on "node"

  def install
    system "npm", "install", *Language::Node.std_npm_install_args(libexec)
    bin.install_symlink Dir["#{libexec}/bin/*"]
  end

  test do
    assert_match version.to_s, shell_output("#{bin}/daedalus --version")
  end
end
