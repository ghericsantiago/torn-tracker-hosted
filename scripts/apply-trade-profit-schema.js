'use strict';
require('dotenv').config();
const fs=require('fs'),path=require('path'),db=require('../db');
(async()=>{const sql=await fs.promises.readFile(path.join(__dirname,'../trade-profit-schema.sql'),'utf8'),c=await db.connect();try{await c.query('BEGIN');await c.query(sql);await c.query('COMMIT');console.log('Trading profit schema applied.')}catch(e){await c.query('ROLLBACK');throw e}finally{c.release();await db.end()}})().catch(e=>{console.error('[trade-profit-schema]',e.message);process.exitCode=1});
