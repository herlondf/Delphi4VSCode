object FormCadastroDemo: TFormCadastroDemo
  Left = 0
  Top = 0
  BorderStyle = bsDialog
  Caption = 'Cadastro de produto'
  ClientHeight = 420
  ClientWidth = 640
  Color = clBtnFace
  Font.Charset = DEFAULT_CHARSET
  Font.Color = clWindowText
  Font.Height = -11
  Font.Name = 'Tahoma'
  Font.Style = []
  Position = poScreenCenter
  TextHeight = 13
  object PanelTopo: TPanel
    Left = 0
    Top = 0
    Width = 640
    Height = 57
    Align = alTop
    BevelOuter = bvNone
    Color = clWhite
    ParentBackground = False
    TabOrder = 0
    object LabelTitulo: TLabel
      Left = 16
      Top = 12
      Width = 180
      Height = 19
      Caption = 'Cadastro de produto'
      Font.Charset = DEFAULT_CHARSET
      Font.Color = clWindowText
      Font.Height = -16
      Font.Name = 'Tahoma'
      Font.Style = [fsBold]
      ParentFont = False
    end
    object LabelSubtitulo: TLabel
      Left = 16
      Top = 34
      Width = 252
      Height = 13
      Caption = 'Os campos com asterisco s'#227'o obrigat'#243'rios'
      Font.Charset = DEFAULT_CHARSET
      Font.Color = clGrayText
      Font.Height = -11
      Font.Name = 'Tahoma'
      Font.Style = []
      ParentFont = False
    end
  end
  object PageControl: TPageControl
    Left = 0
    Top = 57
    Width = 640
    Height = 322
    ActivePage = TabDados
    Align = alClient
    TabOrder = 1
    object TabDados: TTabSheet
      Caption = 'Dados'
      object LabelCodigo: TLabel
        Left = 16
        Top = 19
        Width = 50
        Height = 13
        Caption = 'C'#243'digo *'
      end
      object LabelDescricao: TLabel
        Left = 16
        Top = 46
        Width = 70
        Height = 13
        Caption = 'Descri'#231#227'o *'
      end
      object LabelUnidade: TLabel
        Left = 16
        Top = 73
        Width = 46
        Height = 13
        Caption = 'Unidade'
      end
      object LabelPreco: TLabel
        Left = 296
        Top = 73
        Width = 85
        Height = 13
        Caption = 'Pre'#231'o de venda'
      end
      object EditCodigo: TEdit
        Left = 96
        Top = 16
        Width = 121
        Height = 21
        TabOrder = 0
        Text = 'PRD-00184'
      end
      object EditDescricao: TEdit
        Left = 96
        Top = 43
        Width = 489
        Height = 21
        TabOrder = 1
        Text = 'Cabo HDMI 2.1 - 2 metros'
      end
      object ComboUnidade: TComboBox
        Left = 96
        Top = 70
        Width = 121
        Height = 21
        Style = csDropDownList
        ItemIndex = 0
        TabOrder = 2
        Text = 'UN'
        Items.Strings = (
          'UN'
          'CX'
          'KG')
      end
      object EditPreco: TEdit
        Left = 392
        Top = 70
        Width = 121
        Height = 21
        Alignment = taRightJustify
        TabOrder = 3
        Text = '89,90'
      end
      object GroupBoxSituacao: TGroupBox
        Left = 16
        Top = 108
        Width = 281
        Height = 97
        Caption = 'Situa'#231#227'o'
        TabOrder = 4
        object RadioAtivo: TRadioButton
          Left = 16
          Top = 24
          Width = 113
          Height = 17
          Caption = 'Ativo'
          Checked = True
          TabOrder = 0
          TabStop = True
        end
        object RadioInativo: TRadioButton
          Left = 16
          Top = 45
          Width = 113
          Height = 17
          Caption = 'Inativo'
          TabOrder = 1
        end
        object CheckControlaEstoque: TCheckBox
          Left = 16
          Top = 66
          Width = 137
          Height = 17
          Caption = 'Controla estoque'
          Checked = True
          State = cbChecked
          TabOrder = 2
        end
      end
      object MemoObservacao: TMemo
        Left = 320
        Top = 108
        Width = 265
        Height = 97
        Lines.Strings = (
          'Produto importado. Conferir o NCM'
          'antes de emitir a nota.')
        ScrollBars = ssVertical
        TabOrder = 5
      end
      object GridPrecos: TStringGrid
        Left = 16
        Top = 219
        Width = 569
        Height = 62
        ColCount = 4
        FixedCols = 0
        RowCount = 3
        TabOrder = 6
      end
    end
    object TabFiscal: TTabSheet
      Caption = 'Fiscal'
      ImageIndex = 1
    end
  end
  object PanelRodape: TPanel
    Left = 0
    Top = 379
    Width = 640
    Height = 41
    Align = alBottom
    BevelOuter = bvNone
    TabOrder = 2
    object ButtonOK: TButton
      Left = 464
      Top = 8
      Width = 75
      Height = 25
      Caption = 'OK'
      Default = True
      ModalResult = 1
      TabOrder = 0
    end
    object ButtonCancelar: TButton
      Left = 549
      Top = 8
      Width = 75
      Height = 25
      Cancel = True
      Caption = 'Cancelar'
      ModalResult = 2
      TabOrder = 1
    end
    object ButtonExcluir: TButton
      Left = 16
      Top = 8
      Width = 75
      Height = 25
      Caption = 'Excluir'
      TabOrder = 2
    end
  end
  object ActionList: TActionList
    Left = 264
    Top = 8
  end
  object PopupMenuGrid: TPopupMenu
    Left = 312
    Top = 8
  end
  object TimerAutoSave: TTimer
    Enabled = False
    Interval = 30000
    Left = 360
    Top = 8
  end
end
