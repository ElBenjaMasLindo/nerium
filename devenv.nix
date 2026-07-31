{ pkgs, ... }:

{
  languages = {
    javascript = {
      enable = true;
      package = pkgs.nodejs_24;

      nodejs.enable = true;
      corepack.enable = true;

      pnpm = {
        enable = true;
        install.enable = true;
      };
    };

    typescript = {
      enable = true;
      lsp.enable = true;
    };
  };
}
