pragma solidity 0.5.16;
pragma experimental ABIEncoderV2;

import "./SafeDecimalMath.sol";
import "./State.sol";
import "./Owned.sol";

contract BridgeState is Owned, State {
    using SafeMath for uint;
    using SafeDecimalMath for uint;

    // Sending coin data to external network
    struct Outbounding {
        address account;
        uint amount;
        uint destChainId;
        uint periodId;
        bytes sign;
    }

    // Getting coin data from external network
    struct Inbounding {
        address account;
        uint amount;
        uint srcChainId;
        uint srcOutboundingId;
        bool claimed;
        bytes sign;
    }

    struct OutboundPeriod {
        uint periodId;
        uint startTime;
        uint[] outboundingIds;
        bool processed;
    }

    // Managing authorization
    mapping(bytes32 => mapping(address => bool)) public roles;
    // Network status. If false, network is not ready for bridge.
    mapping(uint => bool) public networkOpened;
    // Account's outbounding request ids, address => periodId => outboundingIds
    mapping(address => mapping(uint => uint[])) public accountOutboundings;
    // Account's inbounding ids to be claimed.
    mapping(address => uint[]) public accountInboundings;
    // ChainId => SrcOutboundingId => bool, It prevents double append inbounding request
    mapping(uint => mapping(uint => bool)) public srcOutboundingIdRegistered;
    // Outbound periods by its id
    mapping(uint => OutboundPeriod) public outboundPeriods;

    // The outbound period id list to be processed
    uint[] internal outboundPeriodIdsToProcess;

    // Inbounding ids to Inbounding
    Inbounding[] public inboundings;
    // Outbounding ids to Outbounding
    Outbounding[] public outboundings;

    bytes32 private constant ROLE_VALIDATOR = "Validator";

    uint public numberOfOutboundPerPeriod = 10;
    uint public periodDuration = 300;

    // total transferred amount
    uint public totalOutboundAmount = 0;
    // total claimed amount
    uint public totalInboundAmount = 0;

    // Current Outbound PeriodId, starts from 0
    uint public currentOutboundPeriodId;

    event SetRole(bytes32 role, address target, bool set);
    event OutboundingAppended(address indexed from, uint amount, uint destChainId, uint outboundId, uint periodId);
    event InboundingAppended(address indexed from, uint amount, uint srcChainId, uint srcOutboundingId, uint inboundId);
    event InboundingClaimed(uint inboundId);
    event PeriodProcessed(uint periodId);
    event NetworkStatusChanged(uint chainId, bool changedTo);
    event PeriodClosed(uint periodId);

    constructor(address _owner, address _associatedContract) public Owned(_owner) State(_associatedContract) {
        outboundPeriods[0] = OutboundPeriod(0, now, new uint[](0), false);
    }

    // ---- VIEWS

    function isOnRole(bytes32 _roleKey, address _account) external view returns (bool) {
        return roles[_roleKey][_account];
    }

    function outboundingsLength() external view returns (uint) {
        return outboundings.length;
    }

    function getTotalOutboundAmount() external view returns (uint) {
        return totalOutboundAmount;
    }

    function inboundingsLength() external view returns (uint) {
        return inboundings.length;
    }

    function getTotalInboundAmount() external view returns (uint) {
        return totalInboundAmount;
    }

    function outboundIdsInPeriod(uint _outboundPeriodId) external view returns (uint[] memory) {
        return outboundPeriods[_outboundPeriodId].outboundingIds;
    }

    function accountOutboundingsInPeriod(address _account, uint _period) external view returns (uint[] memory) {
        return accountOutboundings[_account][_period];
    }

    function applicableInboundIds(address _account) external view returns (uint[] memory) {
        return accountInboundings[_account];
    }

    function outboundRequestIdsInPeriod(address _account, uint _periodId) external view returns (uint[] memory) {
        return accountOutboundings[_account][_periodId];
    }

    function periodIdsToProcess() external view returns (uint[] memory) {
        return outboundPeriodIdsToProcess;
    }

    // ---- MUTATIVE

    function appendOutboundingRequest(
        address _account,
        uint _amount,
        uint _destChainIds,
        bytes calldata _sign
    ) external onlyAssociatedContract {
        _appendOutboundingRequest(_account, _amount, _destChainIds, _sign);
    }

    function appendMultipleInboundingRequests(
        address[] calldata _accounts,
        uint[] calldata _amounts,
        uint[] calldata _srcChainIds,
        uint[] calldata _srcOutboundingIds,
        bytes[] calldata _signs
    ) external onlyValidator {
        uint length = _accounts.length;
        require(length > 0, "Input length is invalid");
        require(
            _amounts.length == length && _srcChainIds.length == length && _srcOutboundingIds.length == length,
            "Input length is not matched"
        );

        for (uint i = 0; i < _amounts.length; i++) {
            _appendInboundingRequest(_accounts[i], _amounts[i], _srcChainIds[i], _srcOutboundingIds[i], _signs[i]);
        }
    }

    function appendInboundingRequest(
        address _account,
        uint _amount,
        uint _srcChainId,
        uint _srcOutboundingId,
        bytes calldata _sign
    ) external onlyValidator {
        require(
            _appendInboundingRequest(_account, _amount, _srcChainId, _srcOutboundingId, _sign),
            "Append inbounding failed"
        );
    }

    function claimInbound(uint _index, uint _amount) external onlyAssociatedContract {
        Inbounding storage _inbounding = inboundings[_index];

        require(!_inbounding.claimed, "This inbounding has already been claimed");
        require(
            verify(_inbounding.account, keccak256(abi.encodePacked(_amount)), _inbounding.sign),
            "the signature is not verified"
        );

        _inbounding.claimed = true;
        totalInboundAmount = totalInboundAmount.add(_amount);

        emit InboundingClaimed(_index);

        uint[] storage ids = accountInboundings[_inbounding.account];
        uint _accountIndex;
        for (uint i = 0; i < ids.length; i++) {
            if (ids[i] == _index) {
                _accountIndex = i;

                break;
            }
        }

        if (_accountIndex < ids.length - 1) {
            for (uint i = _accountIndex; i < ids.length - 1; i++) {
                ids[i] = ids[i + 1];
            }
        }

        delete ids[ids.length - 1];
        ids.length--;
    }

    function closeOutboundPeriod() external onlyValidator {
        require(outboundPeriods[currentOutboundPeriodId].outboundingIds.length > 0, "No outbounding request is in period");

        _closeAndOpenOutboundPeriod();
    }

    function processOutboundPeriod(uint _outboundPeriodId) external onlyValidator {
        require(outboundPeriods[_outboundPeriodId].startTime > 0, "This period id is not started yet");
        require(_isPeriodOnTheProcessList(_outboundPeriodId), "Period is not on the process list");
        require(!outboundPeriods[_outboundPeriodId].processed, "Period has already been processed");

        uint[] storage ids = outboundPeriodIdsToProcess;
        uint _index;
        for (uint i = 0; i < ids.length; i++) {
            if (ids[i] == _outboundPeriodId) {
                _index = i;

                break;
            }
        }

        if (_index < ids.length - 1) {
            for (uint i = _index; i < ids.length - 1; i++) {
                ids[i] = ids[i + 1];
            }
        }

        delete ids[ids.length - 1];
        ids.length--;

        outboundPeriods[_outboundPeriodId].processed = true;

        emit PeriodProcessed(_outboundPeriodId);
    }

    // ---- INTERNAL

    function _appendOutboundingRequest(
        address _account,
        uint _amount,
        uint _destChainId,
        bytes memory _sign
    ) internal {
        require(networkOpened[_destChainId], "Invalid target network");

        uint nextOutboundingId = outboundings.length;

        accountOutboundings[_account][currentOutboundPeriodId].push(nextOutboundingId);

        outboundings.push(Outbounding(_account, _amount, _destChainId, currentOutboundPeriodId, _sign));

        totalOutboundAmount = totalOutboundAmount.add(_amount);

        // The first outbounding request will newly start the period
        if (outboundPeriods[currentOutboundPeriodId].outboundingIds.length == 0) {
            outboundPeriods[currentOutboundPeriodId].startTime = now;
        }
        outboundPeriods[currentOutboundPeriodId].outboundingIds.push(nextOutboundingId);

        emit OutboundingAppended(_account, _amount, _destChainId, nextOutboundingId, currentOutboundPeriodId);

        _periodRefresher();
    }

    function _appendInboundingRequest(
        address _account,
        uint _amount,
        uint _srcChainId,
        uint _srcOutboundingId,
        bytes memory _sign
    ) internal returns (bool) {
        require(!srcOutboundingIdRegistered[_srcChainId][_srcOutboundingId], "Request id is already registered to inbound");

        srcOutboundingIdRegistered[_srcChainId][_srcOutboundingId] = true;

        uint nextInboundingId = inboundings.length;
        inboundings.push(Inbounding(_account, _amount, _srcChainId, _srcOutboundingId, false, _sign));
        accountInboundings[_account].push(nextInboundingId);

        emit InboundingAppended(_account, _amount, _srcChainId, _srcOutboundingId, nextInboundingId);

        return true;
    }

    function _periodRefresher() internal {
        if (_periodIsStaled()) {
            _closeAndOpenOutboundPeriod();
        }
    }

    function _periodIsStaled() internal view returns (bool) {
        uint periodStartTime = outboundPeriods[currentOutboundPeriodId].startTime;
        if (outboundPeriods[currentOutboundPeriodId].outboundingIds.length >= numberOfOutboundPerPeriod) return true;
        if (now.sub(periodStartTime) > periodDuration) return true;

        return false;
    }

    function _closeAndOpenOutboundPeriod() internal {
        outboundPeriodIdsToProcess.push(currentOutboundPeriodId);

        emit PeriodClosed(currentOutboundPeriodId);

        currentOutboundPeriodId = currentOutboundPeriodId.add(1);

        outboundPeriods[currentOutboundPeriodId] = OutboundPeriod(currentOutboundPeriodId, now, new uint[](0), false);
    }

    function _isPeriodOnTheProcessList(uint _outboundPeriodId) internal view returns (bool) {
        for (uint i = 0; i < outboundPeriodIdsToProcess.length; i++) {
            if (outboundPeriodIdsToProcess[i] == _outboundPeriodId) {
                return true;
            }
        }

        return false;
    }

    // ---- Admins ----

    function setRole(
        bytes32 _roleKey,
        address _target,
        bool _set
    ) external onlyOwner {
        roles[_roleKey][_target] = _set;

        emit SetRole(_roleKey, _target, _set);
    }

    function setNumberOfOutboundPerPeriod(uint _number) external onlyOwner {
        require(_number > 0, "Number should larger than zero");

        numberOfOutboundPerPeriod = _number;
    }

    function setPeriodDuration(uint _time) external onlyOwner {
        require(_time > 0, "Time cannot be zero");

        periodDuration = _time;
    }

    function setNetworkStatus(uint _chainId, bool _setTo) external onlyOwner {
        networkOpened[_chainId] = _setTo;

        emit NetworkStatusChanged(_chainId, _setTo);
    }

    modifier onlyValidator() {
        require(roles[ROLE_VALIDATOR][msg.sender], "Caller is not validator");
        _;
    }

    function verify(
        address _signer,
        bytes32 _message,
        bytes memory _signature
    ) internal pure returns (bool) {
        require(_signature.length == 65, "check the signature length");

        bytes memory sig = _signature;
        bytes32 r;
        bytes32 s;
        uint8 v;

        // Split the signature into components r, s and v variables with inline assembly.
        assembly {
            r := mload(add(sig, 0x20))
            s := mload(add(sig, 0x40))
            v := byte(0, mload(add(sig, 0x60)))
        }

        return _signer == verifyHash(_message, v, r, s);
    }

    function verifyHash(
        bytes32 hash,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) internal pure returns (address signer) {
        bytes32 messageDigest = keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", hash));

        return ecrecover(messageDigest, v, r, s);
    }

    // // js sign code
    // let amount = 100;
    // let messageHash = ethers.utils.solidityKeccak256(["string", "bytes"], ["\x19Ethereum Signed Message:\n32", ethers.utils.solidityKeccak256(["bytes"], [ethers.utils.solidityPack(["uint"], [amount])])]);
    // let messageHashBytes = ethers.utils.arrayify(messageHash)
    // let mySignature = await signer.signMessage(messageHashBytes);
}
