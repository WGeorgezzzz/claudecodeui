import express from 'express';

import { requireAuthenticatedUserId } from '@/shared/index.js';
import { asyncHandler, createApiSuccessResponse, AppError } from '@/shared/utils.js';
import { sideChatsService } from '@/modules/side-chats/side-chats.service.js';

/** Server composition mounts these routes behind its authentication middleware. */
export const sideChatsRoutes=express.Router();
sideChatsRoutes.get('/',asyncHandler(async(req,res)=>{
  const parentId=typeof req.query.parentSessionId==='string'?req.query.parentSessionId:'';
  res.json(createApiSuccessResponse(sideChatsService.list(requireAuthenticatedUserId(req),parentId)));
}));
sideChatsRoutes.post('/',asyncHandler(async(req,res)=>{
  if (!req.body || typeof req.body!=='object' || Array.isArray(req.body)) throw new AppError('Expected an object.',{statusCode:400});
  res.status(201).json(createApiSuccessResponse(await sideChatsService.create(requireAuthenticatedUserId(req),req.body)));
}));
sideChatsRoutes.post('/adopt',asyncHandler(async(req,res)=>{
  const {parentSessionId,childSessionId}=req.body??{};
  if (typeof parentSessionId!=='string' || typeof childSessionId!=='string') throw new AppError('Parent and child IDs are required.',{statusCode:400});
  res.json(createApiSuccessResponse(sideChatsService.adopt(requireAuthenticatedUserId(req),parentSessionId,childSessionId)));
}));
sideChatsRoutes.patch('/:id',asyncHandler(async(req,res)=>{
  if (!req.body || typeof req.body!=='object' || Array.isArray(req.body)) throw new AppError('Expected an object.',{statusCode:400});
  res.json(createApiSuccessResponse(await sideChatsService.update(requireAuthenticatedUserId(req),String(req.params.id),req.body)));
}));
