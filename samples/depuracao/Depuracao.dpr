program Depuracao;

{$APPTYPE CONSOLE}

uses
  System.SysUtils;

type
  TCarrinho = class
  private
    FItens: TArray<Currency>;
  public
    procedure Adicionar(const AValor: Currency);
    function Total: Currency;
    function Media: Currency;
  end;

procedure TCarrinho.Adicionar(const AValor: Currency);
begin
  FItens := FItens + [AValor];
end;

function TCarrinho.Total: Currency;
var
  LValor: Currency;
begin
  Result := 0;
  for LValor in FItens do
    Result := Result + LValor;
end;

function TCarrinho.Media: Currency;
begin
  { Ponha o breakpoint AQUI: com o carrinho vazio isto divide por zero. }
  Result := Total / Length(FItens);
end;

var
  LCarrinho: TCarrinho;

begin
  LCarrinho := TCarrinho.Create;
  try
    LCarrinho.Adicionar(19.9);
    LCarrinho.Adicionar(5.1);
    Writeln('total: ', LCarrinho.Total:0:2);
    Writeln('media: ', LCarrinho.Media:0:2);
  finally
    LCarrinho.Free;
  end;
end.
