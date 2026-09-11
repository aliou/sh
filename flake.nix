{
  description = "TypeScript reimplementation of mvdan/sh-style shell parsing";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixpkgs-unstable";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs =
    {
      self,
      nixpkgs,
      flake-utils,
    }:
    flake-utils.lib.eachDefaultSystem (
      system:
      let
        pkgs = import nixpkgs { inherit system; };
      in
      let
        # pnpm_11 in nixpkgs runs on nodejs-slim (24); run it on Node 22 to match
        # the minimum supported version declared in package.json#engines.
        pnpm = pkgs.pnpm_11.override { nodejs-slim = pkgs.nodejs-slim_22; };
      in
      {
        devShells.default = pkgs.mkShell {
          packages = [
            pkgs.nodejs_22
            pnpm
          ];
        };
      }
    );
}
