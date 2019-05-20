jest.mock('../keyValueStore')
jest.mock('../thread')
const Thread = require('../thread')
const ENSURE_CONNECTED = 'ensure connected function'
const ORBITDB = 'orbitdb instance'
const threeIdMock = {
  initKeyringByName: jest.fn(() => {
    return false
  }),
  getKeyringBySpaceName: jest.fn(() => {
    return {
      getDBSalt: jest.fn(),
      symEncrypt: data => { return { ciphertext: 'wow, such encrypted/' + data, nonce: 123 } },
      symDecrypt: data => data.split('/')[1]
    }
  })
}
let rootstoreMockData = []
const rootstoreMock = {
  iterator: () => { return { collect: () => rootstoreMockData } },
  add: jest.fn()
}

const Space = require('../space')


describe('Space', () => {

  let space
  let NAME1 = 'test1'
  let NAME2 = 'test2'

  beforeEach(() => {
    rootstoreMock.add.mockClear()
    threeIdMock.initKeyringByName.mockClear()
    threeIdMock.getKeyringBySpaceName.mockClear()
  })

  it('should be correctly constructed', async () => {
    space = new Space(NAME1, threeIdMock, ORBITDB, rootstoreMock, ENSURE_CONNECTED)
    expect(space._name).toEqual(NAME1)
    expect(space._3id).toEqual(threeIdMock)
    expect(space._rootStore).toEqual(rootstoreMock)
    expect(space._store._orbitdb).toEqual(ORBITDB)
    expect(space._store._ensureConnected).toEqual(ENSURE_CONNECTED)
    expect(space._store._name).toEqual('3box.space.' + NAME1 + '.keyvalue')
  })

  it('should open a new space correctly', async () => {
    let opts = {
      consentCallback: jest.fn(),
    }
    const syncDonePromise = new Promise((resolve, reject) => {
      opts.onSyncDone = resolve
    })
    await space.open(opts)
    expect(opts.consentCallback).toHaveBeenCalledWith(false, NAME1)
    expect(rootstoreMock.add).toHaveBeenCalledWith({ odbAddress:'/orbitdb/myodbaddr' })
    expect(threeIdMock.initKeyringByName).toHaveBeenCalledWith(NAME1)
    expect(threeIdMock.getKeyringBySpaceName).toHaveBeenCalledWith('3box.space.' + NAME1 + '.keyvalue')
    await syncDonePromise
  })

  it('should return directly if space already opened', async () => {
    let opts = {
      consentCallback: jest.fn(),
    }
    await space.open(opts)
    expect(opts.consentCallback).toHaveBeenCalledTimes(0)
  })

  it('should open correctly and not add to rootStore if entry already present', async () => {
    rootstoreMockData.push({ payload: { value: { odbAddress: '/orbitdb/Qmasofgh/3box.space.' + NAME2 + '.keyvalue'} } })
    let opts = {
      consentCallback: jest.fn(),
    }
    const syncDonePromise = new Promise((resolve, reject) => {
      opts.onSyncDone = resolve
    })
    space = new Space(NAME2, threeIdMock, ORBITDB, rootstoreMock, ENSURE_CONNECTED)
    await space.open(opts)
    expect(opts.consentCallback).toHaveBeenCalledWith(false, NAME2)
    expect(rootstoreMock.add).toHaveBeenCalledTimes(0)
    expect(threeIdMock.initKeyringByName).toHaveBeenCalledWith(NAME2)
    expect(threeIdMock.getKeyringBySpaceName).toHaveBeenCalledWith('3box.space.' + NAME2 + '.keyvalue')
    await syncDonePromise
  })

  describe('public store reducer', () => {
    it('get/set/remove works correctly', async () => {
      await space.public.set('k1', 'v1')
      await space.public.set('k2', 'v2')
      await space.public.set('k3', 'v3')
      expect(await space.public.get('k1')).toEqual('v1')
      expect(await space.public.get('k2')).toEqual('v2')
      const entry = await space.public.get('k3', { metadata: true })
      expect(entry.value).toEqual('v3')
      expect(entry.timestamp).toBeGreaterThan(0)

      await space.public.remove('k2')
      expect(await space.public.get('k2')).toBeUndefined()
    })

    it('setMultiple works correctly', async () => {
      await space.public.setMultiple(['k4', 'k5', 'k6'], ['v4', 'v5', 'v6'])
      expect(await space.public.get('k4')).toEqual('v4')
      expect(await space.public.get('k5')).toEqual('v5')
      expect(await space.public.get('k6')).toEqual('v6')
      await space.public.remove('k6')
      expect(await space.public.get('k6')).toBeUndefined()

      expect(space.public.setMultiple(['key'], ['value', 'value1'])).rejects.toEqual(new Error('Arrays must be of the same length'))
      expect(space.public.setMultiple('key', ['value', 'value1'])).rejects.toEqual(new Error('One or more arguments are not an array'))
    })

    it('log should only return public values', async () => {
      const refLog = [{ key: 'k1', op: 'PUT', timeStamp: 123, value: 'v1' }, { key: 'k3', op: 'PUT', timeStamp: 123, value: 'v3' }, { key: 'k4', op: 'PUT', timeStamp: 123, value: 'v4' }, { key: 'k5', op: 'PUT', timeStamp: 123, value: 'v5' } ]
      const log1 = space.public.log
      expect(log1).toEqual(refLog)
      space._store.set('key', 'value')
      const log2 = space.public.log
      expect(log2).toEqual(log1)
    })

    it('all should return all values from public store', async () => {
      const expected = {
        k1: 'v1',
        k3: 'v3',
        k4: 'v4',
        k5: 'v5',
      }

      expect(await space.public.all()).toEqual(expected)

      const result = await space.public.all({ metadata: true })

      Object.entries(expected).map(([k,v]) => {
        expect(result[k].value).toEqual(v)
        expect(result[k].timestamp).toBeGreaterThan(0)
      })
    })

    it('should throw if key not given', async () => {
      expect(space.public.set()).rejects.toEqual(new Error('key is a required argument'))
      expect(space.public.remove()).rejects.toEqual(new Error('key is a required argument'))
    })
  })

  describe('private store reducer', () => {
    it('get/set/remove works correctly', async () => {
      await space.private.set('k1', 'sv1')
      await space.private.set('k2', 'sv2')
      await space.private.set('k3', 'sv3')
      expect(await space.private.get('k1')).toEqual('sv1')
      expect(await space.private.get('k2')).toEqual('sv2')
      const entry = await space.private.get('k3', { metadata: true })
      expect(entry.value).toEqual('sv3')
      expect(entry.timestamp).toBeGreaterThan(0)

      await space.private.remove('k2')
      expect(await space.private.get('k2')).toEqual(null)
    })

    it('setMultiple works correctly', async () => {
      await space.private.setMultiple(['k4', 'k5', 'k6'], ['sv4', 'sv5', 'sv6'])
      expect(await space.private.get('k4')).toEqual('sv4')
      expect(await space.private.get('k5')).toEqual('sv5')
      expect(await space.private.get('k6')).toEqual('sv6')
      await space.private.remove('k6')
      expect(await space.private.get('k6')).toEqual(null)

      expect(space.private.setMultiple(['key'], ['value', 'value1'])).rejects.toEqual(new Error('Arrays must be of the same length'))
      expect(space.private.setMultiple('key', ['value', 'value1'])).rejects.toEqual(new Error('One or more arguments are not an array'))
    })

    it('log should only return private values', async () => {
      const refLog = [{ key: 'k1', op: 'PUT', timeStamp: 123, value: 'sv1' }, { key: 'k3', op: 'PUT', timeStamp: 123, value: 'sv3' }, { key: 'k4', op: 'PUT', timeStamp: 123, value: 'sv4' }, { key: 'k5', op: 'PUT', timeStamp: 123, value: 'sv5' } ]
      const log1 = space.private.log
      expect(log1).toEqual(refLog)
      space._store.set('key', 'value')
      const log2 = space.private.log
      expect(log2).toEqual(log1)
    })

    it('all should return all values from private store', async () => {
      const expected = {
        k1: 'sv1',
        k3: 'sv3',
        k4: 'sv4',
        k5: 'sv5'
      }

      expect(await space.private.all()).toEqual(expected)

      const result = await space.private.all({ metadata: true })
      Object.entries(expected).map(([k,v]) => {
        expect(result[k].value).toEqual(v)
        expect(result[k].timestamp).toBeGreaterThan(0)
      })
    })

    it('should throw if key not given', async () => {
      expect(space.private.set()).rejects.toEqual(new Error('key is a required argument'))
      expect(space.private.remove()).rejects.toEqual(new Error('key is a required argument'))
    })
  })

  describe('Threads', () => {
    beforeEach(() => {
      Thread.mockClear()
    })

    it('subscribes to thread correctly', async () => {
      await space.subscribeThread('t1')
      expect(await space.public.get('thread-t1')).toEqual({ name: 't1' })
      expect(await space.subscribedThreads()).toEqual(['t1'])
    })

    it('unsubscribes from thread correctly', async () => {
      await space.unsubscribeThread('t1')
      expect(await space.public.get('thread-t1')).toEqual()
      expect(await space.subscribedThreads()).toEqual([])
    })

    it('joins thread correctly', async () => {
      const t1 = await space.joinThread('t2')
      expect(Thread).toHaveBeenCalledTimes(1)
      expect(Thread.mock.calls[0][0]).toEqual(ORBITDB)
      expect(Thread.mock.calls[0][1]).toEqual(`3box.thread.${NAME2}.t2`)
      expect(Thread.mock.calls[0][2]).toEqual(threeIdMock)
      expect(t1._load).toHaveBeenCalledTimes(1)
      // function for autosubscribing works as intended
      await Thread.mock.calls[0][3]()
      expect(await space.subscribedThreads()).toEqual(['t2'])
    })

    it('joins thread correctly, no auto subscription', async () => {
      const t1 = await space.joinThread('t3', { noAutoSub: true })
      expect(Thread).toHaveBeenCalledTimes(1)
      expect(Thread.mock.calls[0][0]).toEqual(ORBITDB)
      expect(Thread.mock.calls[0][1]).toEqual(`3box.thread.${NAME2}.t3`)
      expect(Thread.mock.calls[0][2]).toEqual(threeIdMock)
      expect(t1._load).toHaveBeenCalledTimes(1)
      // function for autosubscribing works as intended
      await Thread.mock.calls[0][3]()
      expect(await space.subscribedThreads()).toEqual(['t2'])
    })
  })
})
