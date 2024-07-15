# Metapool Ethereum Staking

Contratos escritos en solidity para el proyecto MetaPool.

# Tabla de Contenidos

- [Introducción](#introducción)
- [Contratos Desplegados en Sepolia](#contratos-desplegados-en-sepolia)
  - [StakingProxy](#stakingproxy)
  - [StakingImpl](#stakingimpl)
  - [LiquidUnstakePoolProxy](#liquidunstakepoolproxy)
  - [LiquidUnstakePoolImpl](#liquidunstakepoolimpl)
  - [WithdrawalProxy](#withdrawalproxy)
  - [WithdrawalImpl](#withdrawalimpl)
- [Descripción de Contratos](#descripción-de-contratos)
  - [Staking](#staking)
  - [LiquidUnstakePool](#liquidunstakepool)

## Introducción

Metapool product for staking on Ethereum, receiving in exchange mpETH.

Allows users to stake ETH or WETH, instant redeem of mpETH (with a small fee) or delayed redeem (1 to 7 days) and add liquidity with ETH or WETH (for instant redeem).

### Contratos desplegados en Sepolia

| Contract                | Address                                    |
|-------------------------|--------------------------------------------|
| StakingProxy            | `0xbd9a06cC557a9e3Eb72C44943dfC13438683e1b9` |
| StakingImpl             | `0xa3CA6021b432a88EEFb5b53B31833e19195b4ecB` |
| LiquidUnstakePoolProxy  | `0xa1ea6cdA04359666d944f9129FE5FC98d534b056` |
| LiquidUnstakePoolImpl   | `0xc448761B4077b4B9889B27196A2156BD87a267d3` |
| WithdrawalProxy         | `0xeF5d75608549AF1209bE069a5D2ceF8bDbE3eae8` |
| WithdrawalImpl          | `0x9674Ee4cC4321e1641c4c9D0F484F8dc99420aD7` |


## Contratos

A continuación se detalla una descripción breve de las funciones que cumplen cada uno de los contratos dentro del protocolo.

### Staking

Contrato principal responsable de gestionar el staking de ETH/WETH y el canje de mpETH.

### LiquidUnstakePool

Pool de liquidez que permite a los usuarios intercambiar inmediatamente mpETH por ETH, sin ningún retraso pero con una pequeña comisión.
Además, los usuarios pueden proporcionar liquidez con ETH o WETH. Este ETH se convertirá lentamente en mpETH a través de intercambios y el contrato de Staking también puede usar este ETH (con algunas limitaciones) para crear nuevos validadores, minteando nuevo mpETH para los proveedores de liquidez.

### Withdrawal

Gestiona el canje retrasado de mpETH de los usuarios. Envía ETH de las recompensas y desmonta a los validadores a los usuarios.
Los usuarios solicitan el retiro en el contrato de Staking y, un epoch después (una semana), completan el retiro en este contrato.

## Instalación de dependencias

El primer paso en nuestro proyecto será instalar las dependencias del proyecto. Para ello ejecutamos

```
npm install
```

## Compilar contratos

Lo primero que deberíamos probar es la compilación de los contratos. El proyecto está configurado de manera tal que utilica la frase MNEMONIC para la compilación y despliegue de contratos.  

### Configuración de MNEMONIC para la Compilación de Contratos

Para compilar los contratos con éxito, es necesario configurar el MNEMONIC. Esto debe almacenarse en un archivo de texto siguiendo la ruta específica: `~/.config/mp-eth-mnemonic.txt`. Esta configuración es crucial para el correcto funcionamiento del archivo de configuración de Hardhat (`hardhat.config.ts`). Sin esta configuración, ejecutar el comando `npm run compile` resultará en un error.

### Importancia de la Seguridad del MNEMONIC

**Nota:** Se recomienda mantener el MNEMONIC fuera del proyecto para prevenir su exposición. En sistemas basados en UNIX/LINUX, es común almacenar valores de configuración sensibles en una carpeta `.config` en la raíz del servidor o en el directorio del usuario. Esto ayuda a centralizar de manera segura la configuración de seguridad.

## Personalizando la Configuración del MNEMONIC

Si lo prefieres, tienes la opción de modificar cómo se carga el MNEMONIC en el proyecto. Por defecto, el MNEMONIC se lee del archivo `~/.config/mp-eth-mnemonic.txt` mencionado anteriormente, pero puedes cambiar esto para que se lea de una variable de entorno en su lugar. Para hacer esto, sigue los siguientes pasos:

1. Localiza el siguiente código
````
const mnemonic = fs.readFileSync(path.join(os.homedir(), ".config/mp-eth-mnemonic.txt")).toString()
````

 en el archivo `lib/env.ts`.

2. Reemplaza el código del paso 1 por lo siguiente:

   ```typescript
   const mnemonic = process.env.MNEMONIC
   ````
3. En el archivo .env debes agregar

   ```typescript
   MNEMONIC="TU FRASE SEMILLA"
   ````

> **Nota:** El archivo `.env` no está creado, debes crearlo por tu cuenta, siguiendo la estructura del archvivo `.env.sample`.


### Configuración archivos .env

This project use multiple .env files
- `.env` for common variables to all network
- `.env.<network>` for network specific variables

For testing with hardhat generated accounts, the `.env` only requires:

```
NETWORK="Network used for all commands"
```

If NETWORK is not set, hardhat will try to use the `Sepolia` network.

For production you will need extra variables. Check `.env.sample` for a list of all variables 

Above this, each network requires a `.env.<network>` file with the following variables:

```
RPC_ENDPOINT="RPC endpoint URL"
BLOCK_NUMBER="Block number to fork"
```

## Commands

Note: 
- All commands also compile the contracts
### Compile contracts
`npm run compile`

### Run tests
`npm test`

### Deploy

Para desplegar los contratos en una red determinada debes tener en cuenta lo siguiente:

En la ruta `lib/constants/network` encontrarás archivos con nombres de algunas redes. Dentro de estos archivos existen algunos valores que debes configurar para el correcto despliegue de los contratos. 

Desplegaremos los contratos en `sepolia`, y este archivo ya existe, pero si quisieras desplegarlos en alguna otra red, debes crear el archivo con el nombre de la red en esta misma ruta y adicionalmente agregar la configuración dentro del archivo `hardhat.config.ts`.

> **Nota:** Dentro del archivo `.env` debes tener configurado la url del nodo en la variable `RPC_ENDPOINT` .

`npm run deploy <network>`

### Verificar Contratos
`npm run verify <network>`

### Actualizar  implementación
`TARGET=Staking npm run upgrade <network>`

### Transfiere proxies admin hacia una multisig
`npm run transfer_to_multisig <network>`

Esto solo transfiere el permiso de administrador para actualizar las implementaciones de los contratos, no el `ADMIN_ROLE`.