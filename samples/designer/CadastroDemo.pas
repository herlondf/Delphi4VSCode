unit CadastroDemo;

interface

uses
  System.SysUtils,
  System.Classes,
  System.Actions,
  Vcl.Controls,
  Vcl.Forms,
  Vcl.StdCtrls,
  Vcl.ExtCtrls,
  Vcl.ComCtrls,
  Vcl.Grids,
  Vcl.Menus,
  Vcl.ActnList;

type
  TFormCadastroDemo = class(TForm)
    PanelTopo: TPanel;
    LabelTitulo: TLabel;
    LabelSubtitulo: TLabel;
    PageControl: TPageControl;
    TabDados: TTabSheet;
    TabFiscal: TTabSheet;
    LabelCodigo: TLabel;
    LabelDescricao: TLabel;
    LabelUnidade: TLabel;
    LabelPreco: TLabel;
    EditCodigo: TEdit;
    EditDescricao: TEdit;
    ComboUnidade: TComboBox;
    EditPreco: TEdit;
    GroupBoxSituacao: TGroupBox;
    RadioAtivo: TRadioButton;
    RadioInativo: TRadioButton;
    CheckControlaEstoque: TCheckBox;
    MemoObservacao: TMemo;
    GridPrecos: TStringGrid;
    PanelRodape: TPanel;
    ButtonOK: TButton;
    ButtonCancelar: TButton;
    ButtonExcluir: TButton;
    ActionList: TActionList;
    PopupMenuGrid: TPopupMenu;
    TimerAutoSave: TTimer;
  end;

implementation

{$R *.dfm}

end.
