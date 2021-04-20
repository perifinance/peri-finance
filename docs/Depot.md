## `Depot`

### `rateNotInvalid(bytes32 currencyKey)`

### `constructor(address _owner, address payable _fundsWallet, address _resolver)` (public)

### `setMaxEthPurchase(uint256 _maxEthPurchase)` (external)

### `setFundsWallet(address payable _fundsWallet)` (external)

Set the funds wallet where ETH raised is held

### `setMinimumDepositAmount(uint256 _amount)` (external)

Set the minimum deposit amount required to depoist pUSD into the FIFO queue

### `fallback()` (external)

Fallback function (exchanges ETH to pUSD)

### `exchangeEtherForPynths() → uint256` (external)

Exchange ETH to pUSD.

### `_exchangeEtherForPynths() → uint256` (internal)

### `exchangeEtherForPynthsAtRate(uint256 guaranteedRate) → uint256` (external)

Exchange ETH to pUSD while insisting on a particular rate. This allows a user to
exchange while protecting against frontrunning by the contract owner on the exchange rate.

### `_exchangeEtherForPERI() → uint256` (internal)

### `exchangeEtherForPERI() → uint256` (external)

Exchange ETH to PERI.

### `exchangeEtherForPERIAtRate(uint256 guaranteedEtherRate, uint256 guaranteedPeriFinanceRate) → uint256` (external)

Exchange ETH to PERI while insisting on a particular set of rates. This allows a user to
exchange while protecting against frontrunning by the contract owner on the exchange rates.

### `_exchangePynthsForPERI(uint256 pynthAmount) → uint256` (internal)

### `exchangePynthsForPERI(uint256 pynthAmount) → uint256` (external)

Exchange pUSD for PERI

### `exchangePynthsForPERIAtRate(uint256 pynthAmount, uint256 guaranteedRate) → uint256` (external)

Exchange pUSD for PERI while insisting on a particular rate. This allows a user to
exchange while protecting against frontrunning by the contract owner on the exchange rate.

### `withdrawPeriFinance(uint256 amount)` (external)

Allows the owner to withdraw PERI from this contract if needed.

### `withdrawMyDepositedPynths()` (external)

Allows a user to withdraw all of their previously deposited pynths from this contract if needed.
Developer note: We could keep an index of address to deposits to make this operation more efficient
but then all the other operations on the queue become less efficient. It's expected that this
function will be very rarely used, so placing the inefficiency here is intentional. The usual
use case does not involve a withdrawal.

### `depositPynths(uint256 amount)` (external)

depositPynths: Allows users to deposit pynths via the approve / transferFrom workflow

### `resolverAddressesRequired() → bytes32[] addresses` (public)

### `periFinanceReceivedForPynths(uint256 amount) → uint256` (public)

Calculate how many PERI you will receive if you transfer
an amount of pynths.

### `periFinanceReceivedForEther(uint256 amount) → uint256` (public)

Calculate how many PERI you will receive if you transfer
an amount of ether.

### `pynthsReceivedForEther(uint256 amount) → uint256` (public)

Calculate how many pynths you will receive if you transfer
an amount of ether.

### `pynthpUSD() → contract IERC20` (internal)

### `periFinance() → contract IERC20` (internal)

### `exchangeRates() → contract IExchangeRates` (internal)

### `MaxEthPurchaseUpdated(uint256 amount)`

### `FundsWalletUpdated(address newFundsWallet)`

### `Exchange(string fromCurrency, uint256 fromAmount, string toCurrency, uint256 toAmount)`

### `PynthWithdrawal(address user, uint256 amount)`

### `PynthDeposit(address user, uint256 amount, uint256 depositIndex)`

### `PynthDepositRemoved(address user, uint256 amount, uint256 depositIndex)`

### `PynthDepositNotAccepted(address user, uint256 amount, uint256 minimum)`

### `MinimumDepositAmountUpdated(uint256 amount)`

### `NonPayableContract(address receiver, uint256 amount)`

### `ClearedDeposit(address fromAddress, address toAddress, uint256 fromETHAmount, uint256 toAmount, uint256 depositIndex)`
