//nifty little library for fast and simple multithreading and zip file creation
/*
 * loosely based on:
 *
 * Minimal ZIP file creator library
 * Copyright (C) 2023 Henrik Brandt
 * https://github.com/henbr/minimal-zip-file-creator
 * > // The CRC32 implementation in this file is a port of the "Slicing-by-4"
 * > // implementation by Stephan Brumme. Copyright of original code:
 * > // Copyright (C) 2011-2016 Stephan Brumme. All rights reserved.
 */

'use strict';

window.NutLib = (function(){

    const Parallel = (function(){

        function ParallelRunner(func, context = {}, maxThreads = navigator.hardwareConcurrency) {
            let workerPool = []
            let taskPool = []
            let taskResolvers = []
            let taskPromises = []
            let taskCount = 0
            let activeTasks = 0
            let workerBusy = []
            let workerAvailabilityTested = false


            const buildExecutionSourcePiece = (name, value) => {
                return `var ${name}=${
                    (typeof value == 'function') ?
                        value.toString() :
                        JSON.stringify(value)};`
            }
            let workerSource = ''
            for (let [name, value] of Object.entries(context)) {
                workerSource += buildExecutionSourcePiece(name, value)
            }
            workerSource += buildExecutionSourcePiece('THREADFUNC', func)
            workerSource += `onmessage=${async e => {
                let result = await THREADFUNC(e.data.a);
                let transferBack = []
                const getTransferable = obj => {
                    if (typeof obj == 'object') {
                        if ([
                            'ArrayBuffer', 'ReadableStream', 'ImageBitmap', 'OffscreenCanvas', 'MediaSourceHandle'
                        ].includes(obj[Symbol.toStringTag])) {
                            transferBack.push(obj)
                        }
                        for (let x of Object.values(obj)) {
                            getTransferable(x)
                        }
                    }
                }
                getTransferable(result)
                postMessage({r: result, i: e.data.i} , transferBack);
            }}`
            const workerSourceURI = URL.createObjectURL(new Blob([workerSource]))

            function resolveTask(e) {
                taskResolvers[e.data.i](e.data.r)
                const workerid = workerBusy.indexOf(e.data.i)
                workerBusy[workerid] = null
                --activeTasks
                queueNextTask()
            }

            async function executeNoWorkers(task) {
                let results
                if ('arg' in task[0] && 'transfer' in task[0]) {
                    results = await func(task[0].arg)
                } else {
                    results = await func(task[0])
                }
                taskResolvers[task[1]](results)
            }

            function queueNextTask() {
                //put execution on hold until we know if we can actually use workers
                //(CSP might fuck up the ability to use them)
                if (workerAvailabilityTested) {
                    if (maxThreads > 0) {
                        //make sure there's at least one free worker
                        if (activeTasks == workerPool.length) {
                            if (workerPool.length < maxThreads) {
                                const w = new Worker(workerSourceURI)
                                w.onmessage = resolveTask
                                workerPool.push(w);
                                workerBusy.push(null)
                            } else {
                                return
                            }
                        }
                        //find a free worker to use
                        let workerid = workerBusy.indexOf(null)
                        let task
                        if ((task = taskPool.pop())) {
                            if ('arg' in task[0] && 'transfer' in task[0]) {
                                workerPool[workerid].postMessage({i: task[1], a: task[0].arg}, task[0].transfer)
                            } else {
                                workerPool[workerid].postMessage({i: task[1], a: task[0]})
                            }
                            workerBusy[workerid] = task[1]
                            ++activeTasks
                        }
                    } else {
                        let task = taskPool.pop()
                        executeNoWorkers(task).then(queueNextTask)
                    }
                }
            }

            function addTask(arg) {
                taskPool.push([arg, taskCount++])
                taskPromises.push(new Promise(resolve => {
                    taskResolvers.push(resolve)
                }))
                queueNextTask()
            }

            async function finalize() {
                let returnValues = await Promise.all(taskPromises)
                for (let x of workerPool) {
                    x.terminate();
                }
                URL.revokeObjectURL(workerSourceURI)
                return returnValues
            }

            //test if Worker threads are blocked
            let testSrc = URL.createObjectURL(new Blob([
                'postMessage({"ok": true});'
            ]))
            let testWorker = new Worker(testSrc)
            let testFinished = () => {
                workerAvailabilityTested = true
                testWorker.terminate()
                queueNextTask()
            }
            testWorker.onerror = () => {
                maxThreads = 0
                testFinished()
            }
            testWorker.onmessage = testFinished
            URL.revokeObjectURL(testSrc)

            return {
                addTask: addTask,
                finalize: finalize
            }
        }

        ParallelRunner.from = async function(func, args) {
            let [,,c,d] = arguments
            let p
            if (typeof c == 'number') {
                p = new ParallelRunner(func, p /*here still undefined*/, c)
            } else {
                p = new ParallelRunner(func, c, d)
            }
            for (let x of args) {
                p.addTask(x)
            }
            return await p.finalize()
        }

        return ParallelRunner
    })()

    const Zip = (function (){

        const getSetters = (dataview) => [(o, v) => dataview.setUint16(o, v, true), (o, v) => dataview.setUint32(o, v, true)]

        async function addFile_thread(args) {

            const crc32Lookup = args.crcLut

            function calculateCrc32(data, previousCrc32 = 0) {
                const [lut0, lut1, lut2, lut3, lut4, lut5, lut6, lut7] = crc32Lookup
                let crc = ~previousCrc32;
                let offset32 = 0;
                const data32 = new Uint32Array(data.buffer, 0, data.buffer.byteLength >>> 2);
                const len8bytes = data32.length & 0xfffffffe;
                let one = 0;
                let two = 0;
                while (offset32 < len8bytes) {
                    one = data32[offset32++] ^ crc;
                    two = data32[offset32++];
                    crc =
                    lut7[one & 0xff] ^
                    lut6[(one >>> 8) & 0xff] ^
                    lut5[(one >>> 16) & 0xff] ^
                    lut4[one >>> 24] ^
                    lut3[two & 0xff] ^
                    lut2[(two >>> 8) & 0xff] ^
                    lut1[(two >>> 16) & 0xff] ^
                    lut0[two >>> 24];
                }
                let offset = offset32 * 4;
                while (offset < data.length) {
                    crc = (crc >>> 8) ^ lut0[(crc & 0xff) ^ data[offset++]];
                }
                return ~crc;
            }


            async function compressFile(data) {
                const compressor = new CompressionStream('deflate-raw')
                const dataStream = new Response(data).body
                const decompressedStream = dataStream.pipeThrough(compressor)
                return await new Response(decompressedStream).arrayBuffer();
            }


            async function addFile(file, compress) {
                let {name, data} = file
                // const n = T.encode(name)
                const d = new Uint8Array(data)

                const crc32 = calculateCrc32(d)
                const storedFile = compress ?
                await compressFile(d) :
                d.buffer;

                let localHeader = new ArrayBuffer(30)
                let lh = new DataView(localHeader)
                let centralHeader = new ArrayBuffer(46)
                let ch = new DataView(centralHeader)

                //ZIP uses timestamps different from the unix epoch
                const date = new Date();
                const year = date.getFullYear();
                const month = date.getMonth() + 1;
                const day = date.getDate();
                const hour = date.getHours();
                const minute = date.getMinutes();
                const second = date.getSeconds();
                const timestamp =  (hour << 11) | (minute << 5) | (second >>> 1);
                const datestamp = (
                    ((year < 1980 ? 0 : year > 2107 ? 0x7f : year - 1980) << 9) |
                    (month << 5) |
                    day
                );

                //construct local header
                let [u16, u32] = getSetters(lh)
                u32(0, 0x04034b50);  //Signature
                compress ?
                    u16(4, 0x0a14) : //required version (ntfs + 2.0)
                    u16(4, 0x0a0a);  //required version (ntfs + 1.0)
                u16(6, 0b0000_1000_0000_0000);   //general flags (utf8 enabled)
                compress ?
                    u16(8, 0x0008) : //deflate
                    u16(8, 0x0000);  //uncompressed
                u16(10, timestamp);
                u16(12, datestamp);
                u32(14, crc32);
                u32(18, storedFile.byteLength);
                u32(22, d.byteLength);
                u16(26, name.byteLength);
                //ArrayBuffer is initialised with zeros anyway
                // u16(28, 0x0000);     //comment length (there is no comment)

                // construct central header entry
                [u16, u32] = getSetters(ch)
                u32(0, 0x02014b50);   //Signature
                u16(4, 0x0a3f);       //created by: ntfs + zip 6.3
                compress ?
                    u16(6, 0x0a14) :  //required version (ntfs + 2.0)
                    u16(6, 0x0a0a);   //required version (ntfs + 1.0)
                u16(8, 0b0000_1000_0000_0000);   //general flags (utf8 enabled)
                compress ?
                    u16(10, 0x0008) :     //deflate
                    u16(10, 0x0000);      //uncompressed
                u16(12, timestamp);
                u16(14, datestamp);
                u32(16, crc32);
                u32(20, storedFile.byteLength);
                u32(24, d.byteLength);
                u16(28, name.byteLength);
                //ArrayBuffer is initialised with zeros anyway
                // u16(30, 0x0000);      //extra field length
                // u16(32, 0x0000);      //comment length (there is no comment)
                // u16(34, 0x0000);      //disk number (this is a single zip)
                // u16(36, 0x0000);      //internal file attributes
                // u32(38, 0x00000000);      //external file attributes
                // u32(42, 0x00000000);      //data offset

                // the data offset is not yet known and will be filled in later

                return {
                    data: storedFile,
                    name: name,
                    localHeader: localHeader,
                    centralHeader: centralHeader
                }

            }

            return await addFile(args.file, args.compress)

        }

        //calculate CRC-32 lookup table
        const crc32Lookup = (function () {
            const lut = Array.from({ length: 8 }, () => new Uint32Array(256));
            const [lut0, lut1, lut2, lut3, lut4, lut5, lut6, lut7] = lut;
            for (let i = 0; i <= 0xff; i++) {
                let crc = i;
                for (let j = 0; j < 8; j++) {
                    crc = (crc >>> 1) ^ ((crc & 1) * 0xedb88320);
                }
                lut0[i] = crc;
            }
            for (let i = 0; i <= 0xff; i++) {
                lut1[i] = (lut0[i] >>> 8) ^ lut0[lut0[i] & 0xff];
                lut2[i] = (lut1[i] >>> 8) ^ lut0[lut1[i] & 0xff];
                lut3[i] = (lut2[i] >>> 8) ^ lut0[lut2[i] & 0xff];
                lut4[i] = (lut3[i] >>> 8) ^ lut0[lut3[i] & 0xff];
                lut5[i] = (lut4[i] >>> 8) ^ lut0[lut4[i] & 0xff];
                lut6[i] = (lut5[i] >>> 8) ^ lut0[lut5[i] & 0xff];
                lut7[i] = (lut6[i] >>> 8) ^ lut0[lut6[i] & 0xff];
            }
            return lut;
        })()

        const T = new TextEncoder()

        /*return async function NutZipFile(files, compress = false) {
            const encodedFileNames = files.map(x => T.encode(x['name']).buffer)
            const threadArgs = files.map((x, i) => {
                let data = x['data']
                if (typeof data == 'string')
                    data = T.encode(data);
                if (data.buffer && typeof data.buffer == 'object')
                    data = data.buffer;
                return {
                    arg: {
                        file: {data: data, nameLength: encodedFileNames[i].byteLength},
                        compress: compress,
                        crcLut: crc32Lookup
                    },
                    transfer: [
                        data
                    ]
                }
            })
            const fileHeaders = await Parallel.from(addFile_thread, threadArgs, {
                [getSetters.name]: getSetters   //ugly syntax needed so minifiers work properly

            })
            let fileParts = []
            let bytes = 0
            let i = 0
            for (let file of fileHeaders) {
                file.offset = bytes
                fileParts.push(file.localHeader)
                fileParts.push(encodedFileNames[i])
                fileParts.push(file.data)
                bytes += file.localHeader.byteLength + encodedFileNames[i++].byteLength + file.data.byteLength
            }
            let cdBytes = 0
            i = 0
            for (let file of fileHeaders) {
                new DataView(file.centralHeader).setUint32(42, file.offset, true)
                fileParts.push(file.centralHeader)
                fileParts.push(encodedFileNames[i])
                cdBytes += file.centralHeader.byteLength + encodedFileNames[i++].byteLength
            }

            const eocdHeader = new ArrayBuffer(22)
            const eocd = new DataView(eocdHeader)
            let [u16, u32] = getSetters(eocd)
            u32(0, 0x06054b50);   //end of central directory marker
            // u16(4, 0);            //disk number (this is a single part zip, so 0)
            // u16(6, 0);            //start disk of eocd
            u16(8, files.length); //no. of central directory entries of disk
            u16(10, files.length);//no. of cd entries total
            u32(12, cdBytes);     //cd size
            u32(16, bytes);       //cd start offset
            // u16(20, 0);           //comment length
            fileParts.push(eocdHeader)

            return new Blob(fileParts, {type: 'application/zip'})

        }*/

        function ZipFileConstructor() {
            const parallelrunner = new Parallel(addFile_thread, {
                [getSetters.name]: getSetters   //ugly syntax needed so minifiers work properly
            })

            function addFile(file, compress = false) {
                let {name, data} = file
                name = T.encode(name).buffer
                if (typeof data == 'string')
                    data = T.encode(data);
                if (data.buffer && typeof data.buffer == 'object')
                    data = data.buffer;
                parallelrunner.addTask({
                    arg: {
                        file: {data: data, name: name},
                        compress: compress,
                        crcLut: crc32Lookup
                    },
                    transfer: [
                        data, name
                    ]
                })
            }

            async function finalize() {
                const fileHeaders = await parallelrunner.finalize()
                let fileParts = []
                let bytes = 0
                for (let file of fileHeaders) {
                    file.offset = bytes
                    fileParts.push(file.localHeader)
                    fileParts.push(file.name)
                    fileParts.push(file.data)
                    bytes += file.localHeader.byteLength + file.name.byteLength + file.data.byteLength
                }
                let cdBytes = 0
                for (let file of fileHeaders) {
                    new DataView(file.centralHeader).setUint32(42, file.offset, true)
                    fileParts.push(file.centralHeader)
                    fileParts.push(file.name)
                    cdBytes += file.centralHeader.byteLength + file.name.byteLength
                }

                const eocdHeader = new ArrayBuffer(22)
                const eocd = new DataView(eocdHeader)
                let [u16, u32] = getSetters(eocd)
                u32(0, 0x06054b50);   //end of central directory marker
                // u16(4, 0);            //disk number (this is a single part zip, so 0)
                // u16(6, 0);            //start disk of eocd
                u16(8, fileHeaders.length); //no. of central directory entries of disk
                u16(10, fileHeaders.length);//no. of cd entries total
                u32(12, cdBytes);     //cd size
                u32(16, bytes);       //cd start offset
                // u16(20, 0);           //comment length
                fileParts.push(eocdHeader)

                return new Blob(fileParts, {type: 'application/zip'})
            }

            this.addFile = addFile
            this.finalize = finalize
        }

        ZipFileConstructor.from = async function CreateZipFrom(files, compress = false) {
            let z = new ZipFileConstructor()
            for (let x of files) {
                z.addFile(x)
            }
            return await z.finalize()
        }

        return ZipFileConstructor
    })()

    return {Parallel, Zip}

})()
