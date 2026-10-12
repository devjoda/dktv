{
  inputs = {
    nixpkgs.url = "nixpkgs/nixos-24.11";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs = {
    self,
    flake-utils,
    nixpkgs,
    ...
  }:
    flake-utils.lib.eachDefaultSystem (system: let
      pkgs = import nixpkgs {inherit system;};
      pythonEnv = pkgs.python3.withPackages (p: with p; [quart hypercorn aiohttp pylint certifi pydantic pytest]);
    in rec {
      devShells.default = pkgs.mkShell {
        buildInputs = [pythonEnv];
      };
      nixosModules.default = {config, ...}:
        with pkgs.lib; {
          options.services.drtvrss = {
            enable = mkEnableOption "drtvrss service";
            host = mkOption {
              description = "DRTVRSS host";
              default = "127.0.0.1:8125";
              type = types.str;
            };
            klagemail = mkOption {
              description = "Complaints E-mail. No longer shown anywhere, but kept so configurations that set it still work";
              default = null;
              type = types.str;
            };
            base_url = mkOption {
              description = "Base URL of the service";
              default = null;
              type = types.str;
            };
            service_name = mkOption {
              description = "Service Name";
              default = "Public Service";
              type = types.str;
            };
            recommended_shows = mkOption {
              description = "Shows that should populate the cache initially";
              default = [];
              type = types.listOf types.str;
            };
          };
          config = mkIf config.services.drtvrss.enable {
            systemd.services.drtvrss = let
              servsrc = pkgs.stdenvNoCC.mkDerivation {
                name = "drtvrss";
                src = ./.;
                buildPhase = ''
                  mkdir -p $out;
                  cp -R ./* $out/
                '';
              };
            in {
              enable = true;
              after = ["network.target"];
              wantedBy = ["multi-user.target"];
              environment.KLAGE_MAIL = config.services.drtvrss.klagemail;
              environment.SERVICE_NAME = config.services.drtvrss.service_name;
              environment.BASE_URL = config.services.drtvrss.base_url;
              environment.PYTHONPATH = "${servsrc}";
              # Without this, Python buffers print() when not writing to a terminal,
              # so log lines would reach the journal late and in batches
              environment.PYTHONUNBUFFERED = "1";
              environment.RECOMMENDED_SHOWS = let
                join = d: l:
                  if pkgs.lib.length l == 0
                  then builtins.elemAt l 0
                  else pkgs.lib.lists.foldl (a: b: a + d + b) (builtins.elemAt l 0) (pkgs.lib.lists.tail l);
              in
                join ":" config.services.drtvrss.recommended_shows;
              serviceConfig = {
                DynamicUser = true;
                Restart = "always";
                # For the codes viewers sync their devices with, see drtvrss/sync.py
                StateDirectory = "drtvrss";
              };

              script = "${pythonEnv}/bin/hypercorn -b ${config.services.drtvrss.host} drtvrss:app";
            };
          };
        };
    });
}
