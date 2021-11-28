{ pkgs ? import <nixpkgs> {} }:

let
  node2nix = import ./node2nix.nix { inherit pkgs; };

  package = node2nix.package.override {
    preInstallPhases = "skipChromiumDownload";

    skipChromiumDownload = ''
      export PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=1
    '';
  };

in pkgs.stdenv.mkDerivation {
  name = "enbridge-scraper";

  src = package;

  buildInputs = with pkgs; [ makeWrapper ];

  installPhase = ''
    mkdir -p $out/bin
    ln -s $src/bin/enbridge-scraper $out/bin/enbridge-scraper

    wrapProgram $out/bin/enbridge-scraper \
      --set PUPPETEER_EXECUTABLE_PATH ${pkgs.chromium.outPath}/bin/chromium
  '';
}
